"""The flat's things (src/game/flat.js): the door in its frame, the phone, the answering machine, the radio.

Built by props.py. Sizes are the game's: the door's opening is DOOR (0.82 by 1.98) in a wall ROOM.wall (0.24)
thick; the phone and the machine stand on the kitchen table.
"""

import math

from kit import (R, Shader, T, block, bevel, box_uv, coil, copy, fillet, join, lamp_material, lathe, mirror,
                 move, prism, smooth, text, tube)

OPENING = (0.82, 1.98)
WALL = 0.24
LEAF = (0.028, 0.072)           # the leaf's room face and back face, into the wall from its room face (y = 0)
HINGE_AXIS = (-0.4085, LEAF[0])


# --- surfaces -----------------------------------------------------------------------------------------------------

def gloss_paint(name='gloss paint', colour=(0.36, 0.33, 0.26), knob=None):
    """Oil gloss on softwood, years of it: the grain and the brush show through, it has yellowed, gone grubby
    in the corners and where hands go, and chipped back to the coat under it on the edges."""
    s = Shader(name)
    uv = s.uv(0.6)
    _, wood_normal, _, _, _ = s.scan('fine_grained_wood', uv)
    wood_normal.node.inputs['Strength'].default_value = 0.25
    stroke = s.noise(1.0, 4.0, s.node('ShaderNodeMapping', Vector=s.uv(), Scale=(90, 3, 1)).outputs['Vector'])
    grime = s.math('MULTIPLY', s.math('SUBTRACT', 1.0, s.occlusion(0.025)), 1.4, clamp=True)
    mottle = s.noise(6.0, 8.0)
    colour = s.mix(colour, (colour[0] * 0.82, colour[1] * 0.76, colour[2] * 0.6), s.ramp(mottle, 0.35, 0.75))
    chips = s.math('MULTIPLY', s.edges(0.003), s.ramp(s.noise(40.0, 6.0), 0.5, 0.62), clamp=True)
    colour = s.mix(colour, (0.42, 0.36, 0.27), chips)                   # the older coat, magnolia gone brown
    colour = s.mix(colour, (0.05, 0.04, 0.03), s.math('MULTIPLY', grime, 0.75))
    rough = s.mix(0.22, 0.55, s.math('MAXIMUM', grime, s.ramp(mottle, 0.55, 0.9, (0.0, 0.5))), 'FLOAT')
    if knob is not None:
        # Where the hand goes for the knob: a greyed, duller patch.
        position = s.node('ShaderNodeNewGeometry').outputs['Position']
        reach = s.node('ShaderNodeVectorMath', _operation='DISTANCE', Vector=position, Vector_001=knob).outputs['Value']
        hand = s.math('MULTIPLY', s.ramp(reach, 0.2, 0.05), s.ramp(s.noise(14.0, 5.0), 0.3, 0.7, (0.5, 1.0)))
        colour = s.mix(colour, (0.12, 0.1, 0.075), s.math('MULTIPLY', hand, 0.55))
        rough = s.mix(rough, 0.6, hand, 'FLOAT')
    height = s.math('ADD', s.math('MULTIPLY', stroke, 0.6), s.math('MULTIPLY', s.noise(300.0, 2.0), 0.15))
    normal = s.bump(height, 0.12, 0.0004, wood_normal)
    return s.out(colour, rough, 0.0, normal)


def brass(name='brass', tarnish=0.6):
    """Old brass: bright where handled, brown and green in the hollows."""
    s = Shader(name)
    rub = s.edges(0.004)
    dirt = s.math('SUBTRACT', 1.0, s.occlusion(0.015))
    blotch = s.ramp(s.noise(30.0, 8.0), 0.4, 0.7)
    colour = s.mix((0.62, 0.43, 0.17), (0.2, 0.15, 0.07), s.math('MULTIPLY', blotch, tarnish))
    colour = s.mix(colour, (0.85, 0.66, 0.32), s.math('MULTIPLY', rub, 0.7))
    colour = s.mix(colour, (0.06, 0.07, 0.04), s.math('MULTIPLY', dirt, 1.2, clamp=True))
    rough = s.mix(s.mix(0.22, 0.48, blotch, 'FLOAT'), 0.15, rub, 'FLOAT')
    normal = s.bump(s.noise(400.0, 3.0), 0.05, 0.0002)
    return s.out(colour, rough, s.mix(1.0, 0.4, s.math('MULTIPLY', dirt, 1.5, clamp=True), 'FLOAT'), normal)


def flat_colour(name, colour, rough=0.5, metal=0.0):
    return Shader(name).out(colour, rough, metal)


# --- the door -------------------------------------------------------------------------------------------------------

def _sweep(name, path, profile, material):
    """A moulding: `profile` [(out, proud)] swept along `path` (points in the wall's plane, x and z), mitred at
    its corners, its `out` side away from the opening (the path runs clockwise round it, seen from the room)."""
    import bmesh
    from mathutils import Vector
    from kit import from_bmesh
    points = [Vector((x, z)) for x, z in path]
    normals = []
    for a, b in zip(points, points[1:]):
        d = (b - a).normalized()
        normals.append(Vector((-d.y, d.x)))        # left of the way it runs: away from the opening
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(points):
        if i == 0:
            m = normals[0]
        elif i == len(points) - 1:
            m = normals[-1]
        else:
            n1, n2 = normals[i - 1], normals[i]
            m = (n1 + n2) / (1 + n1.dot(n2))
        rings.append([bm.verts.new((p.x + m.x * s, -t, p.y + m.y * s)) for s, t in profile])
    for a, b in zip(rings, rings[1:]):
        for k in range(len(profile) - 1):
            bm.faces.new((a[k], b[k], b[k + 1], a[k + 1]))
    for ring, flip in ((rings[0], False), (rings[-1], True)):
        bm.faces.new(list(reversed(ring)) if flip else ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return box_uv(from_bmesh(name, bm, material), 'Z', 1.0)


def _architrave_profile(fine):
    """A torus architrave, 70 mm by 20: a bead on the inside edge, a sloping face, a roll on the outside."""
    steps = 6 if fine else 2
    profile = [(0.0, 0.0), (0.0, 0.008)]
    for k in range(steps + 1):                       # the bead
        a = math.pi * k / steps
        profile.append((0.004 - 0.004 * math.cos(a), 0.008 + 0.004 * math.sin(a)))
    profile += [(0.012, 0.010), (0.042, 0.013)]
    for k in range(1, steps * 2 + 1):                # the roll
        a = math.pi * k / (steps * 2)
        profile.append((0.056 - 0.014 * math.cos(a), 0.013 + 0.007 * math.sin(a) + 0.002 * math.sin(a / 2)))
    profile += [(0.07, 0.008), (0.07, 0.0)]
    return profile


def door(fine):
    """The door in its frame: frame (linings, stops, architrave, the frame's hinge leaves and the striker),
    leaf, knob (both knobs, roses and escutcheons) and hinges (knuckles and the leaf's hinge leaves)."""
    w, h = OPENING
    x0, x1 = -w / 2, w / 2
    seg = 3 if fine else 1
    knob_at = (x1 - 0.068, sum(LEAF) / 2, 1.0)
    paint = gloss_paint('door paint', knob=knob_at)
    frame_paint = gloss_paint('frame paint')
    metal = brass()
    dark = flat_colour('keyhole', (0.01, 0.01, 0.01), 0.7)

    # The frame: linings across the reveal, the stops the leaf shuts on, the architrave round the room side.
    t = 0.025
    frame = [
        block('lining', (x0 - t, -0.002, 0), (x0, WALL, h + t), frame_paint, 0.001, 1),
        block('lining', (x1, -0.002, 0), (x1 + t, WALL, h + t), frame_paint, 0.001, 1),
        block('lining', (x0, -0.002, h), (x1, WALL, h + t), frame_paint, 0.001, 1, grain='X'),
        block('stop', (x0, LEAF[1], 0), (x0 + 0.012, LEAF[1] + 0.025, h), frame_paint, 0.002, seg),
        block('stop', (x1 - 0.012, LEAF[1], 0), (x1, LEAF[1] + 0.025, h), frame_paint, 0.002, seg),
        block('stop', (x0, LEAF[1], h - 0.012), (x1, LEAF[1] + 0.025, h), frame_paint, 0.002, seg, grain='X'),
    ]
    margin = 0.008
    frame.append(_sweep('architrave', [(x0 - margin, 0.0), (x0 - margin, h + margin), (x1 + margin, h + margin), (x1 + margin, 0.0)],
                        _architrave_profile(fine), frame_paint))
    # The striker plate the latch goes into, flush in the lining.
    frame.append(block('striker', (x1 - 0.0005, LEAF[0] + 0.004, knob_at[2] - 0.035), (x1 + 0.0005, LEAF[1] - 0.004, knob_at[2] + 0.035), metal))

    # The leaf: stiles, rails and the muntin, four raised and fielded panels in moulded openings.
    gap = 0.003
    lx0, lx1, lz0, lz1 = x0 + gap, x1 - gap, 0.01, h - gap
    y0, y1 = LEAF
    mid = (y0 + y1) / 2
    stile, top, lock, bottom, muntin = 0.1, 0.1, (0.92, 1.08), 0.22, 0.07
    pieces = [
        block('stile', (lx0, y0, lz0), (lx0 + stile, y1, lz1), paint, 0.0015, seg),
        block('stile', (lx1 - stile, y0, lz0), (lx1, y1, lz1), paint, 0.0015, seg),
        block('rail', (lx0 + stile, y0, lz1 - top), (lx1 - stile, y1, lz1), paint, 0.0015, seg, grain='X'),
        block('rail', (lx0 + stile, y0, lock[0]), (lx1 - stile, y1, lock[1]), paint, 0.0015, seg, grain='X'),
        block('rail', (lx0 + stile, y0, lz0), (lx1 - stile, y1, lz0 + bottom), paint, 0.0015, seg, grain='X'),
        block('muntin', (-muntin / 2, y0, lz0 + bottom), (muntin / 2, y1, lz1 - top), paint, 0.0015, seg),
        block('muntin', (-muntin / 2, y0, lock[1]), (muntin / 2, y1, lz1 - top), paint, 0.0015, seg),
    ]
    openings = [(lx0 + stile, -muntin / 2), (muntin / 2, lx1 - stile)]
    for a, b in openings:
        for c, d in ((lz0 + bottom, lock[0]), (lock[1], lz1 - top)):
            pieces.append(_panel(a, b, c, d, mid, paint))
            for face, sign in ((y0, -1), (y1, 1)):
                # The ovolo round the opening, on both faces.
                r = 0.006
                y = face - sign * 0.004
                ring = [(a + 0.001, y, c + 0.001), (a + 0.001, y, d - 0.001), (b - 0.001, y, d - 0.001), (b - 0.001, y, c + 0.001)]
                pieces.append(tube('moulding', ring, r, 8 if fine else 4, paint, closed=True))
    leaf = join('door_leaf', pieces, 40)

    # The knobs on their spindle, a rose behind each, and the keyhole's escutcheon under them.
    segments = 32 if fine else 14
    knob_profile = [(0.0, 0.0), (0.0275, 0.0), (0.0275, 0.004), (0.026, 0.0065), (0.009, 0.009), (0.007, 0.03), (0.012, 0.038),
                    (0.024, 0.048), (0.028, 0.058), (0.026, 0.066), (0.018, 0.072), (0.0, 0.074)]
    if fine:
        knob_profile = _rounder(knob_profile)
    knobs = []
    for face, sign in ((y0, -1), (y1, 1)):
        k = lathe('knob', knob_profile, segments, metal, axis='Y')
        move(k, T(knob_at[0], face, knob_at[2]) @ (R(180, 'Z') if sign < 0 else R(0, 'Z')))
        knobs.append(k)
        plate = lathe('escutcheon', [(0.0, 0.0), (0.016, 0.0), (0.016, 0.0015), (0.014, 0.0025), (0.0, 0.0025)], segments, metal, axis='Y')
        move(plate, T(knob_at[0], face, knob_at[2] - 0.13) @ (R(180, 'Z') if sign < 0 else R(0, 'Z')))
        knobs.append(plate)
        if fine:
            hole = prism('keyhole', [(-0.0035, -0.012), (0.0035, -0.012), (0.0015, -0.002), (0.0045, 0.004), (0.0, 0.008), (-0.0045, 0.004),
                                     (-0.0015, -0.002)], 0, 0.0003, dark)
            move(hole, T(knob_at[0], face + sign * 0.0026, knob_at[2] - 0.13) @ (R(90, 'X') if sign < 0 else R(180, 'Z') @ R(90, 'X')))
            knobs.append(hole)
    knobs.append(lathe('spindle', [(0.0, 0.0), (0.004, 0.0), (0.004, y1 - y0), (0.0, y1 - y0)], 8, metal, axis='Y', at=(knob_at[0], y0, knob_at[2])))
    knob = join('knob', knobs, 50)

    # Butt hinges, painted over like everything else in the flat: knuckle on the pivot line, a leaf each side.
    ax, ay = HINGE_AXIS
    hinge_parts, frame_leaves = [], []
    for zc in (0.25, h - 0.18):
        length = 0.1
        knuckle = lathe('knuckle', [(0.0, -0.004), (0.004, -0.004), (0.0065, -0.001), (0.0065, length + 0.001), (0.004, length + 0.004), (0.0, length + 0.004)],
                        16 if fine else 8, paint, at=(ax, ay, zc - length / 2))
        hinge_parts.append(knuckle)
        hinge_parts.append(block('hinge leaf', (lx0 - 0.0005, ay + 0.002, zc - length / 2), (lx0 + 0.0003, ay + 0.03, zc + length / 2), paint, 0.0003))
        frame_leaves.append(block('hinge leaf', (x0 - 0.0005, ay + 0.002, zc - length / 2), (x0 + 0.0003, ay + 0.03, zc + length / 2), frame_paint, 0.0003))
    hinges = join('hinges', hinge_parts, 50)
    frame = join('door_frame', frame + frame_leaves, 40)
    return {'door_frame': frame, 'door_leaf': leaf, 'knob': knob, 'hinges': hinges}


def _panel(x0, x1, z0, z1, y, material):
    """A raised and fielded panel between x0..x1, z0..z1 in the plane y: thin at its edges (in the frame's
    grooves), thick in the field, the fielding sloping between."""
    import bmesh
    from kit import from_bmesh
    edge, field, slope = 0.005, 0.009, 0.035
    bm = bmesh.new()
    rims, fields = [], []
    for sign in (-1, 1):
        rims.append([bm.verts.new((x, y + sign * edge, z)) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))])
        fields.append([bm.verts.new((x, y + sign * field, z)) for x, z in
                       ((x0 + slope, z0 + slope), (x1 - slope, z0 + slope), (x1 - slope, z1 - slope), (x0 + slope, z1 - slope))])
    for side in range(2):
        rim, middle = rims[side], fields[side]
        bm.faces.new(middle)
        for k in range(4):
            bm.faces.new((rim[k], rim[(k + 1) % 4], middle[(k + 1) % 4], middle[k]))
    for k in range(4):
        bm.faces.new((rims[0][k], rims[1][k], rims[1][(k + 1) % 4], rims[0][(k + 1) % 4]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return box_uv(from_bmesh('panel', bm, material), 'Z', 1.0)


def _rounder(profile):
    """A lathe profile with each point between two others eased into a curve (Chaikin's corner cutting)."""
    out = [profile[0]]
    for a, b in zip(profile, profile[1:]):
        out.append((a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25))
        out.append((a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75))
    out.append(profile[-1])
    return out


MODELS = {
    'door': dict(
        build=door, size=2048, extrusion=0.006, reach_ao=0.15,
        pivots={'door_leaf': (*HINGE_AXIS, 0.0), 'hinges': (*HINGE_AXIS, 0.0), 'knob': (OPENING[0] / 2 - 0.068, sum(LEAF) / 2, 1.0)},
        parents={'knob': 'door_leaf', 'hinges': 'door_leaf'},
        look='room', close=(0.3, 0.0, 1.0, 0.45), poses={'door_leaf': ('Z', -60)},
    ),
}
