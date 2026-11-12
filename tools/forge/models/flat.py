"""The flat's things (src/game/flat.js): the door in its frame, the phone, the answering machine, the radio.

Built by props.py. Sizes are the game's: the door's opening is DOOR (0.82 by 1.98) in a wall ROOM.wall (0.24)
thick; the phone and the machine stand on the kitchen table.
"""

import math

from kit import R, Shader, T, block, box_uv, coil, fillet, join, lamp_material, lathe, move, prism, text, tube

OPENING = (0.82, 1.98)
WALL = 0.24
LEAF = (0.028, 0.072)           # the leaf's room face and back face, into the wall from its room face (y = 0)
HINGE_AXIS = (-0.4085, LEAF[0])


# --- surfaces -----------------------------------------------------------------------------------------------------

def gloss_paint(name='gloss paint', colour=(0.36, 0.34, 0.29), knob=None):
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
        block('muntin', (-muntin / 2, y0, lz0 + bottom), (muntin / 2, y1, lock[0]), paint, 0.0015, seg),
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
    segments = 32 if fine else 22
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



# --- the phone and the machine ----------------------------------------------------------------------------------------

ALONG_X = ((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1))     # an outline drawn in (y, z), stood along x


def side(name, outline, x0, x1, material, round, segments, grain='X'):
    """A body whose side view is `outline` [(y, z)], running across from x0 to x1."""
    body = prism(name, outline, x0, x1, material, round, segments)
    return box_uv(move(body, ALONG_X), grain, 1.0)


def plastic(name, colour, rough=0.42, scuffed=1.0):
    """Moulded plastic as it is after ten years on a table: a fine spark-eroded grain, rubbed glossy where it is
    handled, scuffed dull elsewhere, grime in every seam."""
    s = Shader(name)
    dirt = s.math('MULTIPLY', s.math('SUBTRACT', 1.0, s.occlusion(0.012)), 1.6, clamp=True)
    scuff = s.math('MULTIPLY', s.ramp(s.noise(60.0, 10.0, distortion=0.4), 0.58, 0.72), scuffed)
    rub = s.edges(0.0015)
    yellowed = s.ramp(s.noise(4.0, 4.0), 0.3, 0.8)
    base = colour
    colour = s.mix(base, tuple(c * k for c, k in zip(base, (0.9, 0.84, 0.7))), yellowed)
    colour = s.mix(colour, tuple(c * 0.55 for c in base), s.math('MULTIPLY', dirt, 0.9))
    colour = s.mix(colour, tuple(min(1.0, c * 1.12) for c in base), s.math('MULTIPLY', scuff, 0.5))
    rough = s.mix(s.mix(rough, rough + 0.2, scuff, 'FLOAT'), rough - 0.18, s.math('MULTIPLY', rub, 0.6), 'FLOAT')
    rough = s.mix(rough, 0.7, dirt, 'FLOAT')
    normal = s.bump(s.math('ADD', s.noise(1500.0, 2.0), s.math('MULTIPLY', scuff, 0.5)), 0.06, 0.0002)
    return s.out(colour, rough, 0.0, normal)


def ink(name, colour, rough=0.5):
    return Shader(name).out(colour, rough, 0.0)


def phone(fine):
    """A push-button desk telephone of the mid-1980s in ivory plastic gone yellow: base (body, keypad, the cradle's
    saddles and hook switch, feet, the cord's socket), handset (resting in the cradle) and its coiled cord."""
    seg = 3 if fine else 1
    shell = plastic('phone plastic', (0.5, 0.44, 0.33))
    keys = plastic('phone keys', (0.42, 0.4, 0.36), 0.38, 0.6)
    rubber = plastic('rubber', (0.02, 0.02, 0.02), 0.8, 0.2)
    print_ = ink('key print', (0.025, 0.022, 0.02), 0.5)
    deck = 0.064
    base = [side('base', [(-0.095, 0.003), (0.095, 0.003), (0.095, deck), (-0.004, deck), (-0.089, 0.029), (-0.095, 0.025)],
                 -0.105, 0.105, shell, 0.006, seg)]
    for x in (-0.085, 0.085):
        for y in (-0.08, 0.08):
            base.append(lathe('foot', [(0.0, 0.0), (0.007, 0.0), (0.007, 0.0035), (0.0, 0.0035)], 12 if fine else 6, rubber, at=(x, y, 0)))
    # The keypad on the slope, in a shallow darker surround; the print on each key.
    slope_from, slope_to = (-0.089, 0.029), (-0.004, deck)
    rise = math.atan2(slope_to[1] - slope_from[1], slope_to[0] - slope_from[0])
    length = math.hypot(slope_to[0] - slope_from[0], slope_to[1] - slope_from[1])
    along = ((slope_to[0] - slope_from[0]) / length, (slope_to[1] - slope_from[1]) / length)

    def on_slope(x, d, up=0.0):
        return T(x, slope_from[0] + along[0] * d, slope_from[1] + along[1] * d) @ R(math.degrees(rise), 'X') @ T(0, 0, up)

    surround = block('surround', (-0.042, -0.04, -0.0012), (0.042, 0.04, 0.0004), plastic('surround', (0.28, 0.25, 0.2), 0.5), 0.0008)
    base.append(move(surround, on_slope(0, 0.044)))
    labels = ['*', '0', '#', '7', '8', '9', '4', '5', '6', '1', '2', '3']
    for row in range(4):
        for col in range(3):
            x, d = (col - 1) * 0.025, 0.017 + row * 0.018
            key = block('key', (-0.0095, -0.0065, -0.002), (0.0095, 0.0065, 0.0042), keys, 0.0022, seg)
            base.append(move(key, on_slope(x, d)))
            if fine:
                base.append(text(labels[row * 3 + col], 0.008, print_, on_slope(x, d, 0.0043)))
    if fine:
        # The parting line between the cover and the base plate, and the number card at the top of the slope.
        seam = ink('seam', (0.03, 0.025, 0.02), 0.8)
        for lo, hi in (((-0.1, -0.0953, 0.0135), (0.1, -0.0948, 0.015)), ((-0.1, 0.0948, 0.0135), (0.1, 0.0953, 0.015)),
                       ((-0.1053, -0.09, 0.0135), (-0.1048, 0.09, 0.015)), ((0.1048, -0.09, 0.0135), (0.1053, 0.09, 0.015))):
            base.append(block('seam', lo, hi, seam))
        card = block('card', (-0.024, -0.0055, -0.0003), (0.024, 0.0055, 0.0003), ink('number card', (0.6, 0.58, 0.5), 0.3))
        base.append(move(card, on_slope(0, 0.081)))
        base.append(text('0161 496 0732', 0.0045, print_, on_slope(0, 0.081, 0.00035)))
    # The cradle: a saddle under each cup and the hook switch between, which the handset holds down.
    for x in (-0.08, 0.08):
        base.append(lathe('saddle', [(0.0, deck - 0.001), (0.025, deck - 0.001), (0.025, deck + 0.002), (0.022, deck + 0.0035), (0.0, deck + 0.0035)],
                          24 if fine else 16, shell, at=(x, 0.045, 0)))
    base.append(block('hook', (-0.007, 0.038, deck - 0.001), (0.007, 0.052, deck + 0.007), keys, 0.002, seg))
    base.append(block('socket', (-0.1065, -0.038, 0.008), (-0.103, -0.022, 0.022), rubber, 0.001))

    # The handset, from where it rests: its cups' faces at z = 0.
    rest = (0.0, 0.045, deck + 0.0035)
    cup = _rounder([(0.0, 0.0), (0.021, 0.0), (0.025, 0.0015), (0.027, 0.006), (0.027, 0.016), (0.024, 0.024), (0.014, 0.028), (0.0, 0.029)])
    handset = []
    for x in (-0.08, 0.08):
        handset.append(lathe('cup', cup, 32 if fine else 22, shell, at=(x, 0, 0)))
        if fine:
            for k in range(7):
                a, r = 2 * math.pi * k / 6, 0.0 if k == 6 else 0.007
                handset.append(lathe('hole', [(0.0, -0.0003), (0.0016, -0.0003), (0.0016, 0.0), (0.0, 0.0)], 8, print_,
                                     at=(x + r * math.cos(a), r * math.sin(a), 0.0)))
    grip = tube('grip', fillet([(-0.085, 0, 0.019), (-0.055, 0, 0.03), (0.055, 0, 0.03), (0.085, 0, 0.019)], 0.04, 6 if fine else 3), 0.0115,
                16 if fine else 12, shell)
    handset.append(move(grip, ((1, 0, 0, 0), (0, 1.55, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1))))
    handset = join('handset', handset, 50)
    move(handset, T(*rest))

    # The coiled cord, from the mouthpiece's end, down onto the table and round into the base's side.
    path = fillet([(-0.104, 0.045, rest[2] + 0.012), (-0.118, 0.04, 0.07), (-0.13, 0.03, 0.045), (-0.138, 0.01, 0.014), (-0.142, -0.03, 0.0062),
                   (-0.138, -0.075, 0.0062), (-0.122, -0.088, 0.0062), (-0.111, -0.062, 0.009), (-0.108, -0.03, 0.015)], 0.015, 4)
    cord = coil(path, 0.0045, 0.0055, 0.0012, 4, 6, shell)
    cord.name = 'cord'
    return {'phone_base': join('phone_base', base, 40), 'handset': handset, 'cord': cord}


def machine(fine):
    """A cassette answering machine of about 1990 in black plastic: the deck (speaker grille, the smoked window
    over the tape, the buttons and their labels) and its message light as `lamp`, which the game blinks."""
    seg = 3 if fine else 1
    shell = plastic('machine plastic', (0.035, 0.034, 0.033), 0.45)
    keys = plastic('machine keys', (0.09, 0.088, 0.085), 0.4, 0.6)
    rubber = plastic('rubber', (0.015, 0.015, 0.015), 0.8, 0.2)
    white = ink('machine print', (0.55, 0.55, 0.52), 0.6)
    red = ink('led lens', (0.18, 0.01, 0.006), 0.15)
    smoke = Shader('smoked window').out((0.006, 0.005, 0.005), 0.08, 0.0)
    # The tape as seen through the smoked lid (drawn on top of it, so already dimmed).
    tape = ink('cassette', (0.012, 0.011, 0.01), 0.1)
    label = ink('cassette label', (0.07, 0.065, 0.05), 0.1)
    top = 0.046
    deck = [side('deck', [(-0.09, 0.004), (0.09, 0.004), (0.09, top), (-0.045, top), (-0.09, 0.029)], -0.11, 0.11, shell, 0.004, seg)]
    for x in (-0.095, 0.095):
        for y in (-0.075, 0.075):
            deck.append(lathe('foot', [(0.0, 0.0), (0.006, 0.0), (0.006, 0.0045), (0.0, 0.0045)], 12 if fine else 6, rubber, at=(x, y, 0)))
    # The speaker: rows of slots on the left of the top.
    for k in range(9):
        y = -0.03 + k * 0.011
        deck.append(block('slot', (-0.098, y - 0.0018, top - 0.002), (-0.018, y + 0.0018, top + (0.0002 if fine else -0.001)), rubber if fine else shell))
    # The cassette bay: a raised frame and the smoked lid, the tape just to be made out under it.
    deck.append(block('bay', (0.0, -0.032, top - 0.001), (0.1, 0.075, top + 0.004), shell, 0.0015, seg))
    deck.append(block('lid', (0.006, -0.026, top + 0.004), (0.094, 0.069, top + 0.0048), smoke, 0.001))
    if fine:
        deck.append(block('tape', (0.016, -0.004, top + 0.0049), (0.084, 0.04, top + 0.005), tape))
        deck.append(block('label', (0.022, 0.012, top + 0.00505), (0.078, 0.034, top + 0.0051), label))
        for x in (0.036, 0.064):
            deck.append(lathe('spool', [(0.0, top + 0.00505), (0.0055, top + 0.00505), (0.0055, top + 0.0051), (0.0, top + 0.0051)], 16, shell,
                              at=(x, 0.0, 0)))
    # Buttons along the front slope, the words for them on the top behind.
    rise = math.degrees(math.atan2(top - 0.029, 0.045))
    names = ['REW', 'PLAY', 'FF', 'STOP', 'MEMO']
    for k, word in enumerate(names):
        x = -0.08 + k * 0.03
        button = block('button', (-0.012, -0.007, -0.002), (0.012, 0.007, 0.004), keys, 0.0015, seg)
        deck.append(move(button, T(x, -0.0675, 0.0375) @ R(rise, 'X')))
        if fine:
            deck.append(text(word, 0.0042, white, T(x, -0.0395, top + 0.0002)))
    deck.append(block('switch', (0.072, -0.074, 0.03), (0.096, -0.06, 0.0405), keys, 0.0015, seg))
    if fine:
        deck.append(text('ANSWER', 0.0036, white, T(0.084, -0.0395, top + 0.0002)))
        deck.append(text('MESSAGE', 0.0032, white, T(0.0855, -0.024, top + 0.0002)))
    deck.append(lathe('lens', [(0.0, top - 0.001), (0.0034, top - 0.001), (0.0034, top + 0.0004), (0.0, top + 0.0004)], 16 if fine else 8, red,
                      at=(0.0855, -0.031, 0)))
    lamp = lathe('lamp', [(0.0, 0.0), (0.0026, 0.0), (0.0026, 0.0008), (0.0018, 0.0018), (0.0, 0.0022)], 12 if fine else 8,
                 lamp_material('message light', (1.0, 0.06, 0.03), 8.0), at=(0.0855, -0.031, top + 0.0004))
    return {'answering_machine': join('answering_machine', deck, 40), 'lamp': lamp}


# --- the radio ------------------------------------------------------------------------------------------------------

def teak(name='teak'):
    """Teak veneer under a lacquer that has gone dull and worn through on the corners."""
    s = Shader(name)
    colour, normal, _, _, _ = s.scan('teak_veneer', s.uv(0.5))
    worn = s.math('MULTIPLY', s.edges(0.004), s.ramp(s.noise(20.0, 6.0), 0.35, 0.6), clamp=True)
    dirt = s.math('MULTIPLY', s.math('SUBTRACT', 1.0, s.occlusion(0.02)), 1.3, clamp=True)
    colour = s.mix(s.mix(colour, (0.16, 0.08, 0.035), 0.25), (0.33, 0.22, 0.13), s.math('MULTIPLY', worn, 0.6))
    colour = s.mix(colour, (0.02, 0.015, 0.01), s.math('MULTIPLY', dirt, 0.7))
    rough = s.mix(s.mix(0.32, 0.5, s.ramp(s.noise(8.0, 6.0), 0.3, 0.8), 'FLOAT'), 0.7, s.math('MAXIMUM', worn, dirt), 'FLOAT')
    return s.out(colour, rough, 0.0, normal)


def cloth(name='grille cloth'):
    """Speaker cloth: a coarse gold-brown weave with a fleck of lurex, dusty."""
    s = Shader(name)
    uv = s.uv(1.0)
    warp = s.node('ShaderNodeTexWave', Vector=uv, Scale=420.0, _wave_type='BANDS', _bands_direction='X').outputs['Fac']
    weft = s.node('ShaderNodeTexWave', Vector=uv, Scale=420.0, _wave_type='BANDS', _bands_direction='Y').outputs['Fac']
    weave = s.math('MULTIPLY', warp, weft)
    colour = s.mix((0.16, 0.1, 0.04), (0.42, 0.3, 0.13), weave)
    colour = s.mix(colour, (0.12, 0.11, 0.1), s.math('MULTIPLY', s.ramp(s.noise(12.0, 6.0), 0.4, 0.8), 0.5))
    return s.out(colour, 0.85, 0.0, s.bump(weave, 0.6, 0.0004))


def metal(name, colour, rough, brushed=True):
    s = Shader(name)
    lines = s.noise(1.0, 4.0, s.node('ShaderNodeMapping', Vector=s.uv(), Scale=(3, 900, 1)).outputs['Vector']) if brushed else s.noise(300.0, 4.0)
    dirt = s.math('MULTIPLY', s.math('SUBTRACT', 1.0, s.occlusion(0.01)), 1.5, clamp=True)
    colour = s.mix(colour, (0.05, 0.045, 0.04), s.math('MULTIPLY', dirt, 0.8))
    return s.out(colour, s.mix(s.mix(rough, rough + 0.12, lines, 'FLOAT'), 0.6, dirt, 'FLOAT'), s.mix(1.0, 0.3, dirt, 'FLOAT'), s.bump(lines, 0.05, 0.0002))


RADIO = dict(wide=0.32, deep=0.11, high=0.19)
DIAL = (0.045, 0.135, 0.105, 0.162)         # the dial window: x from, x to, z from, z to
KNOBS = {'tuning_knob': (0.065, 0.058), 'volume_knob': (0.118, 0.058)}


def radio(fine):
    """A three-band transistor radio of the early 1970s in a teak case: case (front, grille, dial, handle, feet),
    the tuning and volume knobs (turning on their spindles) and the dial's needle (sliding along the scale)."""
    seg = 3 if fine else 1
    w, d, h = RADIO['wide'] / 2, RADIO['deep'] / 2, RADIO['high']
    wood = teak()
    alloy = metal('aluminium', (0.62, 0.62, 0.6), 0.3)
    chrome = metal('chrome', (0.75, 0.75, 0.74), 0.1, brushed=False)
    knob_plastic = plastic('knob plastic', (0.02, 0.019, 0.018), 0.35, 0.4)
    rubber = plastic('rubber', (0.02, 0.02, 0.02), 0.8, 0.2)
    scale = ink('dial scale', (0.62, 0.58, 0.46), 0.12)
    black = ink('dial print', (0.02, 0.018, 0.016), 0.12)
    red = ink('dial red', (0.4, 0.03, 0.02), 0.12)
    hardboard = ink('hardboard', (0.11, 0.075, 0.045), 0.8)
    front = -d
    case = [block('case', (-w, -d, 0.008), (w, d, h), wood, 0.009, 4 if fine else 2, grain='X')]
    for x in (-w + 0.025, w - 0.025):
        for y in (-d + 0.02, d - 0.02):
            case.append(lathe('foot', [(0.0, 0.0), (0.008, 0.0), (0.0085, 0.006), (0.0085, 0.009), (0.0, 0.009)], 12 if fine else 6, rubber, at=(x, y, 0)))
    # The front: a recessed field holding the cloth on the left and the alloy panel on the right, in a thin trim.
    inset = 0.014
    fx0, fx1, fz0, fz1 = -w + inset, w - inset, 0.008 + inset, h - inset
    case.append(block('cloth', (fx0, front - 0.0015, fz0), (0.03, front + 0.004, fz1), cloth(), 0.0005))
    case.append(block('panel', (0.03, front - 0.0025, fz0), (fx1, front + 0.004, fz1), alloy, 0.0008, seg))
    case.append(tube('trim', [(fx0, front - 0.002, fz0), (fx0, front - 0.002, fz1), (fx1, front - 0.002, fz1), (fx1, front - 0.002, fz0)], 0.0022,
                     8 if fine else 4, chrome, closed=True))
    # The dial window: the printed scale behind glass.
    x0, x1, z0, z1 = DIAL
    case.append(block('dial', (x0, front - 0.0035, z0), (x1, front - 0.0024, z1), scale, 0.0006))
    if fine:
        bands = [('FM', z1 - 0.012, [88, 94, 100, 106], (86, 109)), ('MW', z1 - 0.027, [600, 800, 1000, 1400], (520, 1620)),
                 ('LW', z1 - 0.042, [150, 200, 250], (140, 285))]
        for word, z, marks, (lo, hi) in bands:
            case.append(text(word, 0.005, black, T(x0 + 0.006, front - 0.0036, z) @ R(90, 'X')))
            case.append(block('line', (x0 + 0.013, front - 0.0036, z - 0.0035), (x1 - 0.005, front - 0.0035, z - 0.003), black))
            for mark in marks:
                x = x0 + 0.015 + (x1 - x0 - 0.024) * (mark - lo) / (hi - lo)
                case.append(text(str(mark), 0.0046, black, T(x, front - 0.0036, z + 0.0016) @ R(90, 'X')))
                case.append(block('tick', (x - 0.0002, front - 0.0036, z - 0.0035), (x + 0.0002, front - 0.0035, z - 0.0012), black))
        case.append(text('Wyvern', 0.011, chrome, T(-0.095, front - 0.0016, fz1 - 0.022) @ R(90, 'X')))
        case.append(text('VOLUME', 0.0032, black, T(KNOBS['volume_knob'][0], front - 0.0026, KNOBS['volume_knob'][1] + 0.021) @ R(90, 'X')))
        case.append(text('TUNING', 0.0032, black, T(KNOBS['tuning_knob'][0], front - 0.0026, KNOBS['tuning_knob'][1] + 0.021) @ R(90, 'X')))
        for k, word in enumerate(('LW', 'MW', 'FM')):
            case.append(text(word, 0.003, black, T(0.07 + k * 0.012, front - 0.0026, 0.036) @ R(90, 'X')))
    # The band switch: a slider in a slot.
    case.append(block('slot', (0.066, front - 0.0026, 0.026), (0.1, front - 0.002, 0.031), knob_plastic))
    case.append(block('slider', (0.08, front - 0.008, 0.0245), (0.086, front - 0.002, 0.0325), knob_plastic, 0.001, seg))
    # The carrying handle, folded flat on the top, on a boss at each end.
    for x in (-w + 0.03, w - 0.03):
        case.append(lathe('boss', [(0.0, 0.0), (0.008, 0.0), (0.008, 0.006), (0.006, 0.008), (0.0, 0.008)], 16 if fine else 8, chrome, at=(x, 0.0, h - 0.001)))
    handle = fillet([(-w + 0.03, 0.0, h + 0.005), (-w + 0.04, -0.034, h + 0.005), (w - 0.04, -0.034, h + 0.005), (w - 0.03, 0.0, h + 0.005)], 0.012, 4 if fine else 2)
    case.append(tube('handle', handle, 0.0045, 12 if fine else 6, chrome))
    # The back: a hardboard panel let in, with vents.
    case.append(block('back', (-w + 0.012, d - 0.003, 0.02), (w - 0.012, d + 0.0012, h - 0.012), hardboard, 0.001))
    if fine:
        for k in range(8):
            x = -0.1 + k * 0.025
            case.append(block('vent', (x - 0.003, d + 0.0012, 0.07), (x + 0.003, d + 0.0014, 0.15), black))

    parts = {'radio': join('radio', case, 40)}
    knob = [(0.0, 0.0), (0.0135, 0.0), (0.0135, 0.012), (0.0125, 0.0145), (0.011, 0.016), (0.0, 0.016)]
    cap = [(0.0, 0.016), (0.0095, 0.016), (0.0095, 0.0168), (0.0, 0.0168)]
    for name, (x, z) in KNOBS.items():
        pieces = [lathe(name, _rounder(knob) if fine else knob, 40 if fine else 14, knob_plastic, axis='Y'),
                  lathe('cap', cap, 32 if fine else 12, alloy, axis='Y')]
        if fine:
            pieces.append(block('pointer', (-0.0006, 0.0168, 0.004), (0.0006, 0.0170, 0.009), red))
        k = join(name, pieces, 50)
        parts[name] = move(k, T(x, front - 0.0025, z) @ R(180, 'Z'))
    needle = block('needle', (-0.0006, front - 0.0044, z0 + 0.004), (0.0006, front - 0.0036, z1 - 0.004), red)
    parts['needle'] = move(needle, T(x0 + 0.04, 0, 0))
    return parts

MODELS = {
    'door': dict(
        shipped=(1024, 1024, 1024),     # colour, normal, ORM sizes in the GLB
        build=door, size=2048, extrusion=0.006, reach_ao=0.15,
        apart=[['door_leaf', 'knob', 'hinges']],
        pivots={'door_leaf': (*HINGE_AXIS, 0.0), 'hinges': (*HINGE_AXIS, 0.0), 'knob': (OPENING[0] / 2 - 0.068, sum(LEAF) / 2, 1.0)},
        parents={'knob': 'door_leaf', 'hinges': 'door_leaf'},
        look='room', close=(0.3, 0.0, 1.0, 0.45), poses={'door_leaf': [('Z', -60)]},
    ),
    'phone': dict(
        shipped=(1024, 1024, 512),
        build=phone, size=1024, extrusion=0.003, reach_ao=0.05,
        apart=[['handset']],
        pivots={'handset': (0.0, 0.045, 0.0675)},
        look='room', close=(0.0, -0.04, 0.05, 0.22), poses={'handset': [('z', 0.07), ('X', -20)]},
    ),
    'answering_machine': dict(
        shipped=(1024, 512, 512),
        build=machine, size=1024, extrusion=0.003, reach_ao=0.04,
        pivots={'lamp': (0.0855, -0.031, 0.0464)},
        look='room', close=(0.04, -0.04, 0.045, 0.2),
    ),
    'radio': dict(
        shipped=(2048, 1024, 512),
        build=radio, size=2048, extrusion=0.003, reach_ao=0.05,
        apart=[['tuning_knob'], ['volume_knob']],
        pivots={'tuning_knob': (KNOBS['tuning_knob'][0], -RADIO['deep'] / 2 - 0.0025, KNOBS['tuning_knob'][1]),
                'volume_knob': (KNOBS['volume_knob'][0], -RADIO['deep'] / 2 - 0.0025, KNOBS['volume_knob'][1]),
                'needle': (DIAL[0] + 0.04, -RADIO['deep'] / 2 - 0.004, (DIAL[2] + DIAL[3]) / 2)},
        look='room', close=(0.09, -0.06, 0.1, 0.25), poses={'tuning_knob': [('Y', 90)], 'needle': [('x', 0.03)]},
    ),
}
