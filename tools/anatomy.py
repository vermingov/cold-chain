"""Everything inside a whole body: the skeleton, the organs of the chest, belly
and head, and the great vessels, fitted into one of this game's people.

    uv run --with numpy --with scipy tools/anatomy.py <bodyparts3d> <person.bin> <out.bin>

The source is BodyParts3D, as for tools/organs.py, which fits only the belly
for the table. Here the whole man is carried over, piece by piece: the trunk
by organs.py's three stretches, each limb segment by its own joints (the
source's hip and knee onto the person's hip and knee, and so on down), and
the head and neck from the top of the breastbone to the crown. A long bone
therefore runs exactly from joint to joint whatever the two men's builds.

Every part is then hung from one bone of the person's skeleton, the bone of
the ragdoll segment it rides with: a femur on the thigh, the heart on the
chest. The game moves a part with its bone's matrix, as a skin weighted
wholly to that bone. A vessel is a path, and each point of it has its own
bone, so a femoral artery bends at the hip with the leg.

Output: 'CCAF', u32 version, u32 header length, JSON header, then position,
normal (float32 xyz) and index (uint32). Each part: name, kind, bone,
vertexStart, vertexCount, indexStart, indexCount, centre, bounds. Each tube:
name, kind, path [[x, y, z, radius], ...], bones [name per point].
"""

import json
import os
import struct
import sys

import numpy as np
from scipy.spatial import ConvexHull

sys.path.insert(0, os.path.dirname(__file__))
from organs import ORGANS, fit, index_of, middle_line, normals_of, read_named, read_person, skin_of, thin, walls  # noqa: E402

WALL = 0.02         # metres a chest organ keeps from the skin
COVER = 0.006       # and a bone: skin and a little muscle over a rib or a hip
SCALP = 0.006
SIDES = (('Right', 'R'), ('Left', 'L'))

ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']

# Parts carried by the trunk's stretches: name, kind, the source's names, millimetres to a corner. Every bone is a part
# of its own, named as the source names it (lower case): the game breaks them one by one. Small ones are thinned harder.
TRUNK = [(n, k, p, c) for n, k, p, c in ORGANS if n not in ('spine', 'pelvis', 'aorta', 'vena cava')] + [
    ('heart', 'heart', [r'^Wall of ventricle$', r'^Wall of (left|right) atrium$'], 6.0),
    ('trachea', 'airway', [r'^Trachea$', r'^Right main bronchus proper$', r'^Left main bronchus$'], 3.0),
    ('oesophagus', 'oesophagus', [r'^Esophagus$'], 3.0),
    ('diaphragm', 'muscle', [r'^Diaphragm$'], 9.0),
    ('sternum', 'bone', [r'^Manubrium$', r'^Body of sternum$', r'^Xiphoid process$'], 4.0),
] + [(f'{s.lower()} {n} rib', 'bone', [rf'^{s} {n} rib$'], 6.0) for s, _ in (('Right', 'R'), ('Left', 'L')) for n in ORDINALS] + [
    (f'{n} thoracic vertebra', 'bone', [rf'^{n.capitalize()} thoracic vertebra$'], 5.5) for n in ORDINALS] + [
    (f'{n} lumbar vertebra', 'bone', [rf'^{n.capitalize()} lumbar vertebra$'], 6.0) for n in ORDINALS[:5]] + [
    ('sacrum', 'bone', [r'^Sacrum$'], 6.0),
    ('right hip bone', 'bone', [r'^Right hip bone$'], 4.5),
    ('left hip bone', 'bone', [r'^Left hip bone$'], 4.5),
    ('right clavicle', 'bone', [r'^Right clavicle$'], 3.0),
    ('left clavicle', 'bone', [r'^Left clavicle$'], 3.0),
    ('right scapula', 'bone', [r'^Right scapula$'], 5.0),
    ('left scapula', 'bone', [r'^Left scapula$'], 5.0),
]

# The lungs are not in the source as solids, only their airways: each lung is the hull round its bronchial tree,
# swollen out to where the pleura would be.
LUNGS = [(f'{s.lower()} lung', [rf'^{s} .*bronchial tree$', rf'^{s} main bronchus'] + ([r'lingular bronchial tree$'] if s == 'Left' else []))
         for s, _ in SIDES]
SWELL = 1.14

# The skull's bones as one, only to fit the head (head_fit); each is then a part of its own.
SKULL_FIT = [r'^Frontal bone$', r'^(Left|Right) parietal bone$', r'^(Left|Right) temporal bone$', r'^Occipital bone$', r'^Sphenoid bone$',
             r'^(Left|Right) maxilla$', r'^(Left|Right) zygomatic bone$']
HEAD = [
    ('frontal bone', 'skull', [r'^Frontal bone$'], 5.0),
    ('occipital bone', 'skull', [r'^Occipital bone$'], 5.0),
    ('sphenoid bone', 'skull', [r'^Sphenoid bone$'], 4.5),
    ('ethmoid', 'skull', [r'^Ethmoid$'], 4.0),
    ('vomer', 'bone', [r'^Vomer$'], 3.0),
] + [part for s in ('Left', 'Right') for part in [
    (f'{s.lower()} parietal bone', 'skull', [rf'^{s} parietal bone$'], 5.0),
    (f'{s.lower()} temporal bone', 'skull', [rf'^{s} temporal bone$'], 4.5),
    (f'{s.lower()} maxilla', 'bone', [rf'^{s} maxilla$'], 4.0),
    (f'{s.lower()} zygomatic bone', 'bone', [rf'^{s} zygomatic bone$'], 3.5),
    (f'{s.lower()} nasal bone', 'bone', [rf'^{s} nasal bone$'], 2.0),
    (f'{s.lower()} lacrimal bone', 'bone', [rf'^{s} lacrimal bone$'], 2.5),
    (f'{s.lower()} palatine bone', 'bone', [rf'^{s} palatine bone$'], 3.0),
]] + [
    ('mandible', 'bone', [r'^Mandible$'], 3.0),
    ('hyoid bone', 'bone', [r'^Hyoid bone$'], 2.0),
    ('thyroid cartilage', 'cartilage', [r'^Thyroid cartilage$'], 3.0),
    ('cricoid cartilage', 'cartilage', [r'^Cricoid cartilage$'], 2.5),
    ('brain', 'brain', [r'gyrus$', r'^(Left|Right) occipital lobe$', r'^Orbital gyrus$', r'^White matter of (left|right) cerebral hemisphere$'], 8.0),
    ('cerebellum', 'brain', [r'^Cerebellum$'], 6.0),
    ('brainstem', 'brainstem', [r'^Medulla oblongata$', r'^Pons$', r'^Midbrain$'], 4.0),
    ('atlas', 'bone', [r'^Atlas$'], 3.0),
    ('axis', 'bone', [r'^Axis$'], 3.0),
] + [(f'{n} cervical vertebra', 'bone', [rf'^{n.capitalize()} cervical vertebra$'], 4.0) for n in ORDINALS[2:7]]

FINGERS = ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger']
TOES = ['big toe', 'second toe', 'third toe', 'fourth toe', 'little toe']


def limb_parts(s):
    l = s.lower()
    phalanges = lambda digits: [(f'{k} phalanx of {l} {d}', 'bone', [rf'^{k.capitalize()} phalanx of {l} {d}$'], 2.5)
                                for d in digits for k in ('proximal', 'middle', 'distal') if not (k == 'middle' and d in ('thumb', 'big toe'))]
    return {
        'upper arm': [(f'{l} humerus', 'bone', [rf'^{s} humerus$'], 3.0)],
        'forearm': [(f'{l} radius', 'bone', [rf'^{s} radius$'], 2.5), (f'{l} ulna', 'bone', [rf'^{s} ulna$'], 2.5)],
        'hand': [(f'{l} {b}', 'bone', [rf'^{s} {b}$'], 3.0) for b in ('scaphoid', 'lunate', 'triquetral', 'pisiform', 'trapezium', 'capitate', 'hamate')]
            + [(f'{l} {n} metacarpal bone', 'bone', [rf'^{s} {n} metacarpal bone$'], 3.0) for n in ORDINALS[:5]] + phalanges(FINGERS),
        'thigh': [(f'{l} femur', 'bone', [rf'^{s} femur$'], 3.5), (f'{l} patella', 'bone', [rf'^{s} patella$'], 2.5)],
        'shin': [(f'{l} tibia', 'bone', [rf'^{s} tibia$'], 3.5), (f'{l} fibula', 'bone', [rf'^{s} fibula$'], 2.5)],
        'foot': [(f'{l} {b}', 'bone', [rf'^{s} {b}$'], 4.5) for b in ('calcaneus', 'talus', 'cuboid bone', 'medial cuneiform bone', 'intermediate cuneiform bone',
                                                                         'lateral cuneiform bone')]
            + [(f'navicular bone of {l} foot', 'bone', [rf'^Navicular bone of {l} foot$'], 4.0)]
            + [(f'{l} {n} metatarsal bone', 'bone', [rf'^{s} {n} metatarsal bone$'], 4.0) for n in ORDINALS[:5]] + [
                (n, k, p, c + 1.0) for n, k, p, c in phalanges(TOES)],
    }


# A finger's bones go with the finger's own bone (the person's finger bones curl it), not with the hand: the rig's
# finger1 is the thumb (its metacarpal, then two phalanges), finger2 to finger5 the index to the little finger; the
# other four metacarpals are the rig's metacarpal1 (index) to metacarpal4 (little finger) since the hands were rebuilt
# (tools/people.py, 0.8.19). Carpals stay on the wrist (None).
def finger_bone(name, side):
    if name.endswith('metacarpal bone') and not name.endswith('first metacarpal bone'):
        return f'metacarpal{ORDINALS.index(name.split()[1])}.{side}'
    if not (('phalanx' in name and 'toe' not in name) or name.endswith('first metacarpal bone')):
        return None
    digit = next(i for i, d in enumerate(FINGERS) if name.endswith(d) or (d == 'thumb' and name.endswith('first metacarpal bone'))) + 1
    if digit == 1:
        k = 1 if 'metacarpal' in name else 2 if name.startswith('proximal') else 3
    else:
        k = 1 if name.startswith('proximal') else 2 if name.startswith('middle') else 3
    return f'finger{digit}-{k}.{side}'


# Vessels and the cord, as paths: name, kind, the source's names, millimetres of path to a point, where it runs.
def tubes():
    out = [
        ('ascending aorta', 'artery', [r'^Ascending aorta$'], 6.0, 'trunk'),
        ('descending aorta', 'artery', [r'^Descending thoracic aorta$'], 8.0, 'trunk'),
        ('abdominal aorta', 'artery', [r'^Abdominal aorta$'], 8.0, 'trunk'),
        ('superior vena cava', 'vein', [r'^Superior vena cava$'], 6.0, 'trunk'),
        ('inferior vena cava', 'vein', [r'^Inferior vena cava$'], 8.0, 'trunk'),
    ]
    for s, _ in SIDES:
        l = s.lower()
        out += [
            (f'{l} carotid artery', 'artery', [rf'^{s} common carotid artery$'], 6.0, 'neck'),
            (f'{l} jugular vein', 'vein', [rf'^{s} internal jugular vein$'], 6.0, 'neck'),
            (f'{l} subclavian artery', 'artery', [rf'^{s} subclavian artery$'], 5.0, 'trunk'),
            (f'{l} axillary artery', 'artery', [rf'^{s} axillary artery$'], 6.0, f'arm {s}'),
            (f'{l} brachial artery', 'artery', [rf'^{s} brachial artery$'], 8.0, f'arm {s}'),
            (f'{l} radial artery', 'artery', [rf'^{s} radial artery$'], 8.0, f'arm {s}'),
            (f'{l} ulnar artery', 'artery', [rf'^{s} ulnar artery$'], 8.0, f'arm {s}'),
            (f'{l} iliac artery', 'artery', [rf'^{s} common iliac artery$', rf'^{s} external iliac artery$'], 8.0, 'trunk'),
            (f'{l} femoral artery', 'artery', [rf'^{s} femoral artery$'], 8.0, f'leg {s}'),
            (f'{l} popliteal artery', 'artery', [rf'^{s} popliteal artery$'], 8.0, f'leg {s}'),
            (f'{l} tibial artery', 'artery', [rf'^{s} posterior tibial artery$'], 10.0, f'leg {s}'),
        ]
    return out


CORD = 0.0045       # the canal is the hole down the middle; the cord round it is about 9 mm across


# --- frames --------------------------------------------------------------------

def turned(p):
    """Source millimetres (z up, front -y, right -x) to metres in the person's axes (y up, front +z, right +x)."""
    return np.stack([-p[:, 0], p[:, 2], -p[:, 1]], axis=1) / 1000


def end(points, axis, sign, depth=0.02):
    """The middle of the far end of a bone along an axis (sign +1 the top)."""
    v = points[:, axis] * sign
    return points[v > v.max() - depth].mean(axis=0)


def rotation(a, b):
    """The least turn taking direction a onto direction b."""
    a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
    v, c = np.cross(a, b), float(np.dot(a, b))
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k / (1 + c)


def segment(p0, p1, q0, q1, give=0.15):
    """Carries the source segment p0-p1 onto the person's q0-q1: stretched to length along it, and across it by as
    much within `give` (a long-limbed man's bones are not much thicker)."""
    a, b = p1 - p0, q1 - q0
    along = np.linalg.norm(b) / np.linalg.norm(a)
    across = float(np.clip(along, 1 - give, 1 + give))
    turn, unit = rotation(a, b), a / np.linalg.norm(a)

    def carry(points):
        d = points - p0
        on = (d @ unit)[:, None] * unit
        return q0 + (on * along + (d - on) * across) @ turn.T
    return carry


# --- landmarks -----------------------------------------------------------------

def theirs(source, names):
    """The source's joints, in metres in the person's axes."""
    get = lambda pattern: turned(read_named(source, names, [pattern])[0])
    out = {'notch': end(get(r'^Manubrium$'), 1, 1, 0.006)}
    skin = get(r'^Skin$')
    out['crown'] = skin[skin[:, 1] > skin[:, 1].max() - 0.004].mean(axis=0)
    for s, k in SIDES:
        femur, tibia, humerus = get(rf'^{s} femur$'), get(rf'^{s} tibia$'), get(rf'^{s} humerus$')
        top = femur[femur[:, 1] > femur[:, 1].max() - 0.045]
        out[f'hip{k}'] = top[np.abs(top[:, 0]) < np.median(np.abs(top[:, 0]))].mean(axis=0)
        out[f'knee{k}'] = end(femur, 1, -1, 0.015)
        out[f'ankle{k}'] = end(tibia, 1, -1, 0.012)
        toe = get(rf'^Distal phalanx of {s.lower()} second toe$')
        out[f'toe{k}'] = end(toe, 2, 1, 0.004)
        top = humerus[humerus[:, 1] > humerus[:, 1].max() - 0.03]
        out[f'shoulder{k}'] = top[np.abs(top[:, 0]) < np.median(np.abs(top[:, 0]))].mean(axis=0)
        out[f'elbow{k}'] = end(humerus, 1, -1, 0.015)
        forearm = np.concatenate([get(rf'^{s} radius$'), get(rf'^{s} ulna$')])
        out[f'wrist{k}'] = end(forearm, 1, -1, 0.012)
        out[f'knuckle{k}'] = end(get(rf'^{s} third metacarpal bone$'), 1, -1, 0.006)
    return out


def ours(header, arrays):
    bones = {b['name']: np.array(b['head']) for b in header['bones']}
    corners, faces = skin_of(header, arrays)
    skin = corners[np.unique(faces)]        # the skin's own corners, not a hat's or a shoe's
    out = {'notch': (bones['clavicle.L'] + bones['clavicle.R']) / 2}
    out['crown'] = skin[skin[:, 1] > skin[:, 1].max() - 0.004].mean(axis=0)
    for _, k in SIDES:
        out[f'hip{k}'], out[f'knee{k}'], out[f'ankle{k}'] = bones[f'upperleg01.{k}'], bones[f'lowerleg01.{k}'], bones[f'foot.{k}']
        near = skin[(np.abs(skin[:, 0] - bones[f'foot.{k}'][0]) < 0.05) & (skin[:, 1] < 0.08)]
        out[f'toe{k}'] = near[near[:, 2].argmax()]
        out[f'shoulder{k}'], out[f'elbow{k}'] = bones[f'upperarm01.{k}'], bones[f'lowerarm01.{k}']
        out[f'wrist{k}'], out[f'knuckle{k}'] = bones[f'wrist.{k}'], bones[f'finger3-1.{k}']
    return out


# Each limb segment: the joints at either end, and the bone of the person it hangs from.
CHAIN = {
    'arm': [('upper arm', 'shoulder', 'elbow', 'upperarm01'), ('forearm', 'elbow', 'wrist', 'lowerarm01'), ('hand', 'wrist', 'knuckle', 'wrist')],
    'leg': [('thigh', 'hip', 'knee', 'upperleg01'), ('shin', 'knee', 'ankle', 'lowerleg01'), ('foot', 'ankle', 'toe', 'foot')],
}


# --- main ----------------------------------------------------------------------

def main():
    source, person, out = sys.argv[1:4]
    names = index_of(source)
    header, arrays = read_person(person)
    bones = {b['name']: np.array(b['head']) for b in header['bones']}
    tails = {b['name']: np.array(b['tail']) for b in header['bones']}
    carry_mm = fit(source, names, header, arrays)
    a, b = theirs(source, names), ours(header, arrays)
    wall_at = walls(header, arrays)
    side_at = walls(header, arrays, along=0, over=(2, 1))

    # The neck is the line from the breastbone to the crown, but how far forward a head sits on it differs between two
    # men: the skull is then moved to sit inside the person's own head, a scalp's thickness in from the back and top.
    fitted = segment(a['notch'], a['crown'], b['notch'], b['crown'], give=0.1)
    skull = fitted(turned(read_named(source, names, SKULL_FIT)[0]))
    corners, faces = skin_of(header, arrays)
    skin = corners[np.unique(faces)]        # the skin's own corners: a hat's or a hood's would set the skull by the hat
    scalp = skin[skin[:, 1] > skull[:, 1].min() + 0.06]
    shift = np.array([0.0, min(0.0, scalp[:, 1].max() - SCALP - skull[:, 1].max()), scalp[:, 2].min() + SCALP - skull[:, 2].min()])
    print(f'head: skull moved {shift[1] * 1000:.0f} mm up, {shift[2] * 1000:.0f} mm forward')
    head_fit = lambda points: fitted(points) + shift
    limbs = {}
    for s, k in SIDES:
        for limb, chain in CHAIN.items():
            for seg, j0, j1, bone in chain:
                limbs[(s, seg)] = (segment(a[j0 + k], a[j1 + k], b[j0 + k], b[j1 + k]), f'{bone}.{k}', a[j0 + k], a[j1 + k])

    def trunk_bone(y):
        if y < bones['spine03'][1]:
            return 'root'
        if y < bones['spine01'][1]:
            return 'spine03'
        return 'spine01' if y < bones['neck01'][1] else 'neck01'

    def onto(corners, own, wrist):
        """A bone of the hand, carried with the hand from wrist to knuckles, then laid along its own bone of the rig:
        the hand's one stretch put the fingers where the source man's were (straight, together), not where this person's
        are (spread, curled a little), so they stood out of the skin. A phalanx runs joint to joint, the rig's bone's
        head to its tail; a metacarpal of the rig starts at the wrist, so the bone keeps its length and ends at the
        knuckle. Its ends are the extremes along its long axis, the nearer the wrist the base."""
        middle = corners.mean(axis=0)
        axis = np.linalg.svd(corners - middle, full_matrices=False)[2][0]
        t = (corners - middle) @ axis
        e0, e1 = corners[t < t.min() + 0.0015].mean(axis=0), corners[t > t.max() - 0.0015].mean(axis=0)
        if np.linalg.norm(e1 - wrist) < np.linalg.norm(e0 - wrist):
            e0, e1 = e1, e0
        q0, q1 = bones[own], tails[own]
        if own.startswith('metacarpal'):
            q0 = q1 - (q1 - q0) / np.linalg.norm(q1 - q0) * np.linalg.norm(e1 - e0)
        return segment(e0, e1, q0, q1, give=0.2)(corners)

    def press(corners, wall=WALL):
        """A part nearer the skin than `wall`, front, back or side, is pressed back in: the old man's ribs are a thin
        man's ribs stretched, and came out through his back."""
        front, back = wall_at(corners)
        corners[:, 2] = np.maximum(np.minimum(corners[:, 2], front - wall), np.minimum(back + wall, front - wall))
        outer, inner = side_at(corners)
        corners[:, 0] = np.maximum(np.minimum(corners[:, 0], outer - wall), np.minimum(inner + wall, outer - wall))

    def outside(corners):
        """How many corners lie outside the skin seen from the front."""
        front, back = wall_at(corners)
        over = np.maximum(corners[:, 2] - front, back - corners[:, 2])
        return f'{int((over > 0).sum())} by up to {max(0, over.max()) * 1000:.0f} mm'


    parts, positions, normals, indices = [], [], [], []
    base = {'v': 0, 'i': 0}

    def add(name, kind, bone, corners, faces):
        outward = normals_of(corners, faces)
        faces = faces[:, ::-1]      # the mirror between the frames turned every triangle over
        parts.append({'name': name, 'kind': kind, 'bone': bone, 'vertexStart': base['v'], 'vertexCount': len(corners),
                      'indexStart': base['i'], 'indexCount': faces.size, 'centre': corners.mean(axis=0).round(4).tolist(),
                      'bounds': [corners.min(axis=0).round(4).tolist(), corners.max(axis=0).round(4).tolist()]})
        positions.append(corners.astype(np.float32))
        normals.append(outward.astype(np.float32))
        indices.append((faces + base['v']).astype(np.uint32))
        print(f'{name:22} {kind:10} {bone:14} {len(corners):6} {len(faces):7}  outside {outside(corners)}')
        base['v'] += len(corners)
        base['i'] += faces.size

    print(f'{"part":22} {"kind":10} {"bone":14} {"corners":>6} {"tris":>7}')
    for name, kind, patterns, cell in TRUNK:
        corners, faces = thin(*read_named(source, names, patterns), cell)
        corners = carry_mm(corners)
        press(corners, COVER if kind == 'bone' else WALL)
        add(name, kind, trunk_bone(corners[:, 1].mean()), corners, faces)

    for name, patterns in LUNGS:
        raw = read_named(source, names, patterns)[0]
        corners = carry_mm(raw)
        hull = ConvexHull(corners)
        corners = corners[hull.vertices]
        remap = {v: i for i, v in enumerate(hull.vertices)}
        faces = np.array([[remap[v] for v in tri] for tri in hull.simplices])
        middle = corners.mean(axis=0)
        corners = middle + (corners - middle) * SWELL
        press(corners)
        # The hull's triangles face any way: turn each to face out of the middle, in the source's handedness.
        tri = corners[faces]
        face = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        inward = (face * (tri.mean(axis=1) - middle)).sum(axis=1) > 0
        faces[inward] = faces[inward][:, ::-1]
        add(name, 'lung', 'spine01', corners, faces)

    for name, kind, patterns, cell in HEAD:
        corners, faces = read_named(source, names, patterns)
        corners, faces = thin(turned(corners), faces, cell / 1000)
        # (The mandible goes with the jaw the face opens, tools/people.py's face rig; the rest with the neck and head.)
        add(name, kind, 'jaw' if name == 'mandible' and 'jaw' in bones else 'neck01', head_fit(corners), faces)

    for s, k in SIDES:
        for seg, listed in limb_parts(s).items():
            carry, bone = limbs[(s, seg)][:2]
            for name, kind, patterns, cell in listed:
                corners, faces = read_named(source, names, patterns)
                corners, faces = thin(turned(corners), faces, cell / 1000)
                corners = carry(corners)
                # (A finger's bones and the thumb's metacarpal ride on the finger's own bone, the other metacarpals on the
                # rig's; the rest of the hand on the wrist.)
                own = finger_bone(name, k) if seg == 'hand' else None
                if own:
                    corners = onto(corners, own, bones[f'wrist.{k}'])
                add(name, kind, own or bone, corners, faces)

    # The paths. A point on a limb belongs to whichever segment of it the point lies along.
    def place(points, where):
        out, owners = np.empty_like(points), []
        for i, p in enumerate(points):
            if where == 'trunk':
                q = carry_back(p)
                owners.append(trunk_bone(q[1]))
            elif where == 'neck':
                if p[1] > a['notch'][1]:
                    q = head_fit(p[None])[0]
                    owners.append('neck01')
                else:
                    q = carry_back(p)
                    owners.append(trunk_bone(q[1]))
            else:
                limb, s = where.split()
                chain = CHAIN[limb]
                seg = chain[-1][0]
                for name, *_ in chain:
                    _, _, p0, p1 = limbs[(s, name)]
                    if (p - p0) @ (p1 - p0) / ((p1 - p0) @ (p1 - p0)) < 1:
                        seg = name
                        break
                carry, bone = limbs[(s, seg)][:2]
                q = carry(p[None])[0]
                owners.append(bone)
            out[i] = q
        return out, owners

    # organs.py's stretches take the source's millimetres; turn back to them for the trunk's points.
    def carry_back(p):
        mm = np.array([-p[0], -p[2], p[1]]) * 1000
        return carry_mm(mm[None])[0]

    tube_list = []
    for name, kind, patterns, every, where in tubes():
        corners = turned(read_named(source, names, patterns, smallest=False)[0])
        path = middle_line(corners, every / 1000)
        points, owners = place(path[:, :3], where)
        radius = np.full(len(path), CORD) if kind == 'cord' else path[:, 3]
        tube_list.append({'name': name, 'kind': kind, 'path': np.column_stack([points, radius]).round(4).tolist(), 'bones': owners})
        print(f'{name:22} {kind:10} path of {len(path):3}, {np.linalg.norm(np.diff(points, axis=0), axis=1).sum() * 1000:5.0f} mm, '
              f'{radius.mean() * 2000:4.1f} mm across, bones {sorted(set(owners))}')

    # The cord runs down the canal through the vertebrae, which is near the middle of each of them, from the skull
    # to the second lumbar.
    order = ['Atlas', 'Axis'] + [f'{n} cervical vertebra' for n in ('Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh')] + \
        [f'{n} thoracic vertebra' for n in ('First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth',
                                            'Tenth', 'Eleventh', 'Twelfth')] + ['First lumbar vertebra', 'Second lumbar vertebra']
    middles = np.array([turned(read_named(source, names, [f'^{n}$'])[0]).mean(axis=0) for n in order])
    points, owners = place(middles, 'neck')
    tube_list.append({'name': 'spinal cord', 'kind': 'cord', 'path': np.column_stack([points, np.full(len(points), CORD)]).round(4).tolist(),
                      'bones': owners})
    print(f'spinal cord: {len(points)} points, {np.linalg.norm(np.diff(points, axis=0), axis=1).sum() * 1000:.0f} mm, bones {sorted(set(owners))}')

    blobs = {'position': np.concatenate(positions).tobytes(), 'normal': np.concatenate(normals).tobytes(), 'index': np.concatenate(indices).tobytes()}
    types = {'position': 'float32', 'normal': 'float32', 'index': 'uint32'}
    listed, offset = [], 0
    for key, blob in blobs.items():
        listed.append({'name': key, 'type': types[key], 'offset': offset, 'length': len(blob)})
        offset += len(blob)
    head = json.dumps({
        'body': header['name'], 'parts': parts, 'tubes': tube_list, 'arrays': listed,
        'source': 'BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan',
    }).encode()
    head += b' ' * (-len(head) % 4)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(b'CCAF' + struct.pack('<II', 1, len(head)) + head + b''.join(blobs.values()))
    print(f'{out}: {base["v"]} corners, {base["i"] // 3} triangles, {os.path.getsize(out) // 1024}K')


if __name__ == '__main__':
    main()
