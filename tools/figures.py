#!/usr/bin/env python3
"""The people in the corridors.

Builds the game's figures out of MakeHuman's base mesh, skeleton and skin
weights, all of which MakeHuman publishes as CC0. Nothing here is modelled by
hand: a body is the base mesh pushed through a handful of MakeHuman's own
macro targets (sex, age, muscle, weight, height), which is how MakeHuman itself
makes one.

    uv run --with numpy tools/figures.py <makehuman>/makehuman/data

The data directory needs 3dobjs/base.obj, rigs/default.mhskel,
rigs/default_weights.mhw and targets/macrodetails/. A sparse clone of
github.com/makehumancommunity/makehuman has all of it.

Output is one small binary per body in assets/figure/, read by
src/figure.js. The format is a JSON header followed by raw little-endian
arrays, because the only reader is ours and the glTF loader is another
megabyte of JavaScript to ship for no gain.

Coordinates are converted from MakeHuman's (right-handed, decimetres, facing
+Z) to Babylon's (left-handed, metres). Mirroring X keeps the figure facing +Z
with its own left side at -X, which is where a left side belongs in a
left-handed frame. The mirror also turns MakeHuman's counter-clockwise
triangles into the clockwise ones Babylon treats as front faces, which is the
same trick Babylon's own glTF loader plays with a negative scale, so the
indices go out in their original order.
"""

import json
import os
import struct
import sys
from pathlib import Path

import numpy as np

# FIGURES_OUT builds somewhere else first: the game is served straight out of
# this tree, and a player loading while a file is half written gets a broken
# body. Build aside, then move the files in.
OUT = Path(os.environ.get('FIGURES_OUT', Path(__file__).resolve().parent.parent / 'assets' / 'figure'))

# --- bodies -----------------------------------------------------------------
#
# Slider values in MakeHuman's own terms, 0..1 with 0.5 as the average.
# Everything in the corridors is underfed: muscle and weight sit near the
# bottom of their range, and they are tall, because a figure a head taller
# than the player reads as wrong before it reads as a person.

BODIES = {
    'gaunt': {'gender': 0.85, 'age': 0.55, 'muscle': 0.12, 'weight': 0.02, 'height': 0.80},
    'woman': {'gender': 0.08, 'age': 0.50, 'muscle': 0.20, 'weight': 0.05, 'height': 0.62},
    'child': {'gender': 0.50, 'age': 0.24, 'muscle': 0.30, 'weight': 0.10, 'height': 0.50},
    'long': {'gender': 0.70, 'age': 0.50, 'muscle': 0.05, 'weight': 0.0, 'height': 0.45},
    'spider': {'gender': 0.60, 'age': 0.60, 'muscle': 0.05, 'weight': 0.0, 'height': 0.40},
    'blank': {'gender': 0.15, 'age': 0.45, 'muscle': 0.15, 'weight': 0.05, 'height': 0.60},
}

# Past anything MakeHuman offers. Some of the people down here are not people:
# bones made longer, by prefix, and the body stretched along them (see
# `stretch`), and one whose face has been smoothed away to nothing.
SHAPES = {
    # Too tall in all the wrong places: a neck like a stalk, arms that hang
    # past the knee, fingers a hand long.
    'long': {'stretch': {'neck': 2.3, 'upperarm': 1.3, 'lowerarm': 1.45, 'finger': 1.9, 'spine': 1.06}},
    # Built to go on all fours: every limb far too long for the body.
    'spider': {'stretch': {'upperarm': 1.55, 'lowerarm': 1.7, 'finger': 2.3, 'upperleg': 1.3, 'lowerleg': 1.4, 'neck': 1.4}},
    # No face at all.
    'blank': {'faceless': True},
}

# --- skeleton ---------------------------------------------------------------
#
# MakeHuman's default rig has 163 bones. The game animates about seventy: the
# spine, limbs and fingers, the jaw, the eyes and eyelids, and the two
# muscles that pull the corners of the mouth. Every other bone hands its
# weights up to its nearest kept ancestor, so toes move with the foot and the
# small facial muscles move with the head.

KEEP = [
    'root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01',
    'neck01', 'neck02', 'neck03', 'head', 'jaw',
    'eye.L', 'eye.R', 'orbicularis03.L', 'orbicularis03.R',
    'orbicularis04.L', 'orbicularis04.R', 'risorius03.L', 'risorius03.R',
]
for s in ('L', 'R'):
    KEEP += [f'{b}.{s}' for b in (
        'clavicle', 'shoulder01', 'upperarm01', 'upperarm02',
        'lowerarm01', 'lowerarm02', 'wrist',
        'pelvis', 'upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02', 'foot')]
    for f in range(1, 6):
        KEEP += [f'finger{f}-{k}.{s}' for k in (1, 2, 3)]

# Groups of the base mesh that become parts of a figure, in draw order.
# Anything not listed (tights, genitals, eyelashes, the joint cubes) is left
# out of the output entirely.
PARTS = [
    ('body', ['body']),
    ('cloth', ['body-cloth']),
    ('eyes', ['helper-l-eye', 'helper-r-eye']),
    ('teeth', ['helper-upper-teeth', 'helper-lower-teeth']),
    ('tongue', ['helper-tongue']),
    ('robe', ['helper-skirt']),
]

# Hair is not MakeHuman's: its `helper-hair` is the volume a hair proxy is
# fitted to, and rendered it is a black slab with the torch's stripes on it.
# It is grown here instead as ribbons hanging from the scalp (see `hair()`).
# (length in metres, strands), or None for bald. The men's is thin and long
# enough to hang in their faces; the stretched ones have none.
HAIR = {
    'gaunt': (0.34, 170, False), 'woman': (0.56, 320, True), 'child': (0.38, 320, True),
    'long': None, 'spider': None, 'blank': (0.5, 280, False),
}

DM = 0.1   # MakeHuman works in decimetres


def read_obj(path):
    verts, uvs, faces = [], [], []
    group = None
    with open(path) as fh:
        for line in fh:
            if line.startswith('v '):
                verts.append([float(x) for x in line.split()[1:4]])
            elif line.startswith('vt '):
                uvs.append([float(x) for x in line.split()[1:3]])
            elif line.startswith('g '):
                group = line[2:].strip()
            elif line.startswith('f '):
                corners = [c.split('/') for c in line.split()[1:]]
                faces.append((group,
                              [int(c[0]) - 1 for c in corners],
                              [int(c[1]) - 1 for c in corners]))
    return np.array(verts), np.array(uvs), faces


def read_target(path):
    idx, delta = [], []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split()
            idx.append(int(parts[0]))
            delta.append([float(x) for x in parts[1:4]])
    # Some targets are empty on purpose: the average body is the base mesh.
    return np.array(idx, dtype=np.int64), np.array(delta).reshape(-1, 3)


# --- MakeHuman's macro modifier, reduced to what the bodies above use ---------

def ramp3(v):
    """min/average/max weights for a 0..1 slider with 0.5 as the average."""
    if v < 0.5:
        return {'min': 1 - v * 2, 'average': v * 2, 'max': 0.0}
    return {'min': 0.0, 'average': 1 - (v - 0.5) * 2, 'max': (v - 0.5) * 2}


def age_weights(a):
    # MakeHuman: 0 is one year old, 0.1875 eleven, 0.5 twenty-five, 1 ninety.
    if a < 0.1875:
        return {'baby': 1 - a / 0.1875, 'child': a / 0.1875}
    if a < 0.5:
        t = (a - 0.1875) / (0.5 - 0.1875)
        return {'child': 1 - t, 'young': t}
    t = (a - 0.5) / 0.5
    return {'young': 1 - t, 'old': t}


def build_body(verts, targets_dir, spec, cache):
    out = verts.copy()

    def add(name, weight):
        if weight < 1e-4:
            return
        path = targets_dir / name
        if not path.exists():
            raise SystemExit(f'missing target {path}')
        if name not in cache:
            cache[name] = read_target(path)
        idx, delta = cache[name]
        out[idx] += delta * weight

    genders = {'female': 1 - spec['gender'], 'male': spec['gender']}
    ages = age_weights(spec['age'])
    muscles = {k + 'muscle': v for k, v in ramp3(spec['muscle']).items()}
    weights = {k + 'weight': v for k, v in ramp3(spec['weight']).items()}
    h = spec['height']
    heights = {'minheight': max(0.0, 1 - h * 2), 'maxheight': max(0.0, h * 2 - 1)}

    for g, gw in genders.items():
        for a, aw in ages.items():
            add(f'caucasian-{g}-{a}.target', gw * aw)
            for m, mw in muscles.items():
                for w, ww in weights.items():
                    add(f'universal-{g}-{a}-{m}-{w}.target', gw * aw * mw * ww)
                    for ht, hw in heights.items():
                        add(f'height/{g}-{a}-{m}-{w}-{ht}.target', gw * aw * mw * ww * hw)
    return out


# --- skeleton and weights ----------------------------------------------------

def skeleton(skel, verts):
    joints = {k: verts[v].mean(axis=0) for k, v in skel['joints'].items()}
    bones = skel['bones']

    def kept_ancestor(name):
        while name is not None and name not in KEEP:
            name = bones[name]['parent']
        return name

    out = []
    for name in KEEP:
        b = bones[name]
        out.append({
            'name': name,
            'parent': kept_ancestor(b['parent']),
            'head': joints[b['head']],
            'tail': joints[b['tail']],
        })
    remap = {name: kept_ancestor(name) for name in bones}
    return out, remap


def skin_weights(weights_json, remap, index_of, count):
    per_vertex = [dict() for _ in range(count)]
    for bone, pairs in weights_json.items():
        target = index_of[remap[bone]]
        for v, w in pairs:
            d = per_vertex[v]
            d[target] = d.get(target, 0.0) + w

    joints = np.zeros((count, 4), dtype=np.uint8)
    amounts = np.zeros((count, 4), dtype=np.uint8)
    for v, d in enumerate(per_vertex):
        top = sorted(d.items(), key=lambda kv: -kv[1])[:4]
        total = sum(w for _, w in top) or 1.0
        q = [int(round(w / total * 255)) for _, w in top]
        # Quantising can leave the sum a unit off, and a vertex whose weights
        # do not add to one drifts from its bones when they move.
        if q:
            q[0] += 255 - sum(q)
        for i, ((b, _), w) in enumerate(zip(top, q)):
            joints[v, i] = b
            amounts[v, i] = w
    return joints, amounts


# --- clothes -----------------------------------------------------------------
#
# Nobody here is modelled with clothes on. What reads as a robe is the body
# itself from the collar to the wrists and ankles, drawn in its own matte black
# material, and softened first: the shape of a chest or a ribcage under a torch
# is what makes a figure read as undressed rather than dressed in black.

def regions(bones, joints, amounts):
    """Which vertices the robe covers, by the bones that carry them: the same
    rule src/figure.js uses to colour them."""
    def group(name):
        if name.startswith(('head', 'jaw', 'eye', 'orbicularis', 'risorius')): return 'face'
        if name.startswith('neck'): return 'neck'
        if name.startswith(('wrist', 'finger')): return 'hands'
        if name.startswith('foot'): return 'feet'
        if name.startswith(('clavicle', 'shoulder', 'upperarm', 'lowerarm')): return 'arms'
        if name.startswith(('pelvis', 'upperleg', 'lowerleg')): return 'legs'
        return 'torso'
    groups = [group(b['name']) for b in bones]
    share = {g: np.zeros(len(joints)) for g in set(groups)}
    for k in range(4):
        for i, g in enumerate(groups):
            share[g] += np.where(joints[:, k] == i, amounts[:, k] / 255.0, 0)
    torso = share['torso'] > 0.35
    covered = torso | (share['arms'] > 0.5) | (share['legs'] > 0.5)
    return covered, share['torso']


def soften(pos, faces, weight, rounds=12, shrink=False):
    """Taubin smoothing, applied in proportion to `weight` (0..1 per vertex):
    it takes the anatomy out of a surface without shrinking it the way plain
    Laplacian smoothing does. With `shrink`, plain Laplacian instead, which
    does shrink, and so flattens: a nose goes back into the face."""
    nbrs = [set() for _ in range(len(pos))]
    for g, vs, _ in faces:
        if g != 'body':
            continue
        for i in range(len(vs)):
            a, b = vs[i], vs[(i + 1) % len(vs)]
            nbrs[a].add(b)
            nbrs[b].add(a)
    idx = np.array([i for i in np.where(weight > 0)[0] if nbrs[i]], dtype=np.int64)
    nb = [np.array(sorted(nbrs[i]), dtype=np.int64) for i in idx]
    w = weight[idx][:, None]
    p = pos.copy()
    for r in range(rounds):
        step = 0.5 if shrink or r % 2 == 0 else -0.53
        avg = np.array([p[n].mean(axis=0) for n in nb])
        p[idx] += (avg - p[idx]) * step * w
    return p


def dress(faces, covered):
    """Body faces the robe covers become their own group, so they can be
    drawn in the cloth material."""
    out = []
    for g, vs, ts in faces:
        if g == 'body' and sum(covered[v] for v in vs) * 2 > len(vs):
            g = 'body-cloth'
        out.append((g, vs, ts))
    return out


# --- shapes nobody should have ------------------------------------------------

def stretch(verts, bones, joints, amounts, factors):
    """Lengthen bones and carry the body with them.

    Each bone whose name starts with a key of `factors` is made that many
    times longer, and everything below it in the hierarchy moves out to
    match. A vertex goes where its bones take it: for each bone it is weighted
    to, its offset from the bone's head is scaled along the bone's own axis
    only, so a limb gets longer without getting fatter or shearing, and a
    vertex shared between two bones at a joint lands in the same place from
    both. Returns the new vertices and each bone's new head and tail."""
    def factor(name):
        base = name.split('.')[0]
        for prefix, f in factors.items():
            if base.startswith(prefix):
                return f
        return 1.0

    names = [b['name'] for b in bones]
    parent = [names.index(b['parent']) if b['parent'] else -1 for b in bones]
    old_head = np.array([b['head'] for b in bones], dtype=np.float64)
    old_tail = np.array([b['tail'] for b in bones], dtype=np.float64)
    f = np.array([factor(n) for n in names])
    axis = old_tail - old_head
    axis /= np.maximum(np.linalg.norm(axis, axis=1, keepdims=True), 1e-9)

    new_head = old_head.copy()
    for i in range(len(bones)):
        p = parent[i]
        if p >= 0:
            new_head[i] = new_head[p] + (old_head[i] - old_head[p]) * f[p]
    new_tail = new_head + (old_tail - old_head) * f[:, None]

    n = len(verts)
    out = np.zeros_like(verts)
    total = np.zeros(n)
    for k in range(4):
        b = joints[:n, k].astype(int)
        w = amounts[:n, k] / 255.0
        d = verts - old_head[b]
        along = np.einsum('ij,ij->i', d, axis[b])
        moved = new_head[b] + d + ((f[b] - 1) * along)[:, None] * axis[b]
        out += w[:, None] * moved
        total += w
    loose = total < 1e-6                     # vertices nothing is weighted to stay put
    out[loose] = verts[loose]
    out[~loose] /= total[~loose][:, None]
    return out, new_head, new_tail


def efface(verts, faces, bones, joints, rounds=70):
    """Smooth the face away: everything in front of the skull that the head
    carries, flattened until there is no nose, no mouth and no sockets, only
    the shape of a face with nothing on it."""
    head_bones = [i for i, b in enumerate(bones)
                  if b['name'].startswith(('head', 'jaw', 'eye', 'orbicularis', 'risorius'))]
    n = 13380
    on_head = np.isin(joints[:n, 0], head_bones)
    head = verts[:n][on_head]
    centre = head.mean(axis=0)
    front = np.zeros(len(verts))
    # MakeHuman faces +Z: the face is the front of the head, fading out toward
    # the ears so the smoothing has no edge.
    z = (verts[:n, 2] - centre[2]) / (np.ptp(head[:, 2]) / 2 or 1)
    front[:n] = np.where(on_head, np.clip((z - 0.05) / 0.45, 0, 1), 0)
    return soften(verts, faces, front, rounds=rounds, shrink=True)


# --- mesh --------------------------------------------------------------------

def smooth_normals(pos, faces):
    n = np.zeros_like(pos)
    for _, vs, _ in faces:
        p = pos[vs]
        # Quads, and not always planar: the sum of the two triangle normals is
        # the area-weighted normal of the whole face.
        for a, b, c in ((0, 1, 2), (0, 2, 3)) if len(vs) == 4 else ((0, 1, 2),):
            fn = np.cross(p[b] - p[a], p[c] - p[a])
            for k in (a, b, c):
                n[vs[k]] += fn
    lens = np.linalg.norm(n, axis=1, keepdims=True)
    lens[lens == 0] = 1
    return n / lens


def eye_uv(p, centre, radius):
    """Planar UVs for an eyeball, looking straight down its front pole.

    The helper eyes carry no usable texture space, and the only thing drawn on
    an eye is a set of rings around the front, which a flat projection along
    the gaze gets exactly right on the half anyone ever sees."""
    d = (p - centre) / radius
    return [0.5 + d[0] * 0.5, 0.5 - d[1] * 0.5]


def assemble(pos, uvs, faces, normals, joints, amounts):
    """Split vertices wherever a UV seam runs through them and emit triangles.

    Positions here are already in game space, so the winding is reversed as
    each triangle is written."""
    out_pos, out_nrm, out_uv, out_j, out_w = [], [], [], [], []
    indices = []
    parts = []

    for part, groups in PARTS:
        chosen = [f for f in faces if f[0] in groups]
        remap = {}
        start_i = len(indices)
        start_v = len(out_pos)

        eye_centres = {}
        if part == 'eyes':
            for g in groups:
                vs = sorted({v for f in chosen if f[0] == g for v in f[1]})
                c = pos[vs].mean(axis=0)
                r = np.linalg.norm(pos[vs] - c, axis=1).max()
                eye_centres[g] = (c, r)

        for g, vs, ts in chosen:
            local = []
            for v, t in zip(vs, ts):
                key = (v, t if part != 'eyes' else -1)
                if key not in remap:
                    remap[key] = len(out_pos)
                    out_pos.append(pos[v])
                    out_nrm.append(normals[v])
                    if part == 'eyes':
                        c, r = eye_centres[g]
                        out_uv.append(eye_uv(pos[v], c, r))
                    else:
                        u = uvs[t]
                        out_uv.append([u[0], 1 - u[1]])
                    out_j.append(joints[v])
                    out_w.append(amounts[v])
                local.append(remap[key])
            tris = [(0, 1, 2), (0, 2, 3)] if len(local) == 4 else [(0, 1, 2)]
            for a, b, c in tris:
                indices += [local[a], local[b], local[c]]

        parts.append({
            'name': part,
            'indexStart': start_i, 'indexCount': len(indices) - start_i,
            'vertexStart': start_v, 'vertexCount': len(out_pos) - start_v,
        })

    return (np.array(out_pos, dtype=np.float32), np.array(out_nrm, dtype=np.float32),
            np.array(out_uv, dtype=np.float32), np.array(out_j, dtype=np.uint8),
            np.array(out_w, dtype=np.uint8), np.array(indices, dtype=np.uint32), parts)


def hair(game, normals, joints, head_bone, length, count, fringe, seed):
    """Long hair as a few hundred thin ribbons, in game space.

    Each strand is rooted on the scalp, runs down over the skull and then
    hangs, and every point of it is pushed back out of the body wherever it
    went in, so it lies over the shoulders and down the back rather than
    through them. Some of it falls in front of the face. Every vertex belongs
    wholly to the head bone: at the speed these people move, hair that turns
    with the head is all the physics it needs."""
    rng = np.random.default_rng(seed)
    body = game[:13380]
    head = body[joints[:13380, 0] == head_bone]
    centre = head.mean(axis=0)
    centre[1] = head[:, 1].min() + (head[:, 1].max() - head[:, 1].min()) * 0.55
    radial = head - centre

    def surface(d):
        # Out along d to the furthest head vertex within a few degrees of it.
        u = radial / np.linalg.norm(radial, axis=1, keepdims=True)
        near = u @ d > 0.985
        reach = (radial[near] @ d).max() if near.any() else 0.09
        return centre + d * (reach + 0.004)

    def push_out(p):
        # Nearest point of the body, and back out along its normal if p went in.
        k = np.argmin(((body - p) ** 2).sum(axis=1))
        depth = (p - body[k]) @ normals[k]
        return p + normals[k] * (0.006 - depth) if depth < 0.006 else p

    roots = []
    golden = np.pi * (3 - np.sqrt(5))
    n = 900
    for i in range(n):
        y = 1 - 2 * (i + 0.5) / n
        r = np.sqrt(1 - y * y)
        d = np.array([np.cos(golden * i) * r, y, np.sin(golden * i) * r])
        if d[1] < -0.2:
            continue                                  # under the skull
        face = d[2] > 0.3 and d[1] < 0.5              # the face, below the hairline
        # Without a fringe only the back and the sides grow any: a root on the
        # crown would slide forward down the forehead and hang in the face.
        if face or (not fringe and d[2] > -0.05 and abs(d[0]) < 0.75):
            continue
        roots.append(d)
    roots = [roots[i] for i in rng.permutation(len(roots))[:count]]

    pos, nrm, uv, index = [], [], [], []
    width = 0.011
    segments = 14
    for d in roots:
        p = surface(d)
        forward = fringe and d[2] > 0.35              # the hairline: some of it falls over the face
        strand = [p]
        if forward:
            heading = np.array([d[0] * 0.4, -0.6, 1.0])
        elif fringe:
            heading = np.array([d[0], -1.2, d[2]])
        else:
            heading = np.array([d[0], -1.0, min(d[2], 0.0) - 0.6])     # combed back
        heading /= np.linalg.norm(heading)
        seg = length * rng.uniform(0.8, 1.1) / segments
        for k in range(segments):
            # Starts following the skull outward and down, then hangs.
            fall = min(1.0, (k + 1) / 5)
            h = heading * (1 - fall) + np.array([0, -1.0, 0]) * fall
            h /= np.linalg.norm(h)
            p = push_out(p + h * seg)
            strand.append(p)
        base = len(pos)
        for k, q in enumerate(strand):
            out = q - centre
            out[1] = 0
            out /= np.linalg.norm(out) or 1
            along = strand[min(k + 1, segments)] - strand[max(k - 1, 0)]
            side = np.cross(along, out)
            side /= np.linalg.norm(side) or 1
            w = width * (1 - 0.6 * k / segments)
            pos += [q - side * w / 2, q + side * w / 2]
            nrm += [out, out]
            uv += [[0, k / segments], [1, k / segments]]
        for k in range(segments):
            a = base + k * 2
            index += [a, a + 2, a + 1, a + 1, a + 2, a + 3]

    count = len(pos)
    j = np.zeros((count, 4), dtype=np.uint8)
    j[:, 0] = head_bone
    w = np.zeros((count, 4), dtype=np.uint8)
    w[:, 0] = 255
    return (np.array(pos, dtype=np.float32), np.array(nrm, dtype=np.float32),
            np.array(uv, dtype=np.float32), j, w, np.array(index, dtype=np.uint32))


def to_game(p):
    """MakeHuman decimetres, right-handed -> Babylon metres, left-handed."""
    q = np.array(p, dtype=np.float64) * DM
    q[..., 0] *= -1
    return q


def write(path, header, arrays):
    blobs = []
    offset = 0
    layout = []
    for name, arr in arrays:
        raw = np.ascontiguousarray(arr).tobytes()
        pad = (-len(raw)) % 4
        layout.append({'name': name, 'offset': offset, 'length': len(raw),
                       'type': str(arr.dtype)})
        blobs.append(raw + b'\0' * pad)
        offset += len(raw) + pad
    header = dict(header, arrays=layout)
    head = json.dumps(header, separators=(',', ':')).encode()
    head += b' ' * ((-len(head)) % 4)
    with open(path, 'wb') as fh:
        fh.write(b'SIXF')
        fh.write(struct.pack('<II', 1, len(head)))
        fh.write(head)
        for b in blobs:
            fh.write(b)


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    data = Path(sys.argv[1])
    verts, uvs, faces = read_obj(data / '3dobjs' / 'base.obj')
    skel = json.loads((data / 'rigs' / 'default.mhskel').read_text())
    weights = json.loads((data / 'rigs' / 'default_weights.mhw').read_text())['weights']
    OUT.mkdir(parents=True, exist_ok=True)
    cache = {}

    for name, spec in BODIES.items():
        shape = SHAPES.get(name, {})
        body = build_body(verts, data / 'targets' / 'macrodetails', spec, cache)
        bones, remap = skeleton(skel, body)
        index_of = {b['name']: i for i, b in enumerate(bones)}
        joints, amounts = skin_weights(weights, remap, index_of, len(body))
        if 'stretch' in shape:
            body, heads, tails = stretch(body, bones, joints, amounts, shape['stretch'])
            for b, h, t in zip(bones, heads, tails):
                b['head'], b['tail'] = h, t
        if shape.get('faceless'):
            body = efface(body, faces, bones, joints)
        covered, torso = regions(bones, joints, amounts)
        # Only the trunk is softened, and fading in from where the torso bones
        # take over, so the neck and the shoulders keep their shape.
        body = soften(body, faces, np.clip((torso - 0.45) / 0.35, 0, 1) * covered)
        dressed = dress(faces, covered)

        game = to_game(body)
        floor = game[:13380, 1].min()       # the soles of the feet stand on y = 0
        game[:, 1] -= floor
        normals = smooth_normals(game, faces)
        # smooth_normals sees the mirrored positions with the original winding,
        # which points every normal inward; flipping here is cheaper than
        # computing them twice.
        normals = -normals

        pos, nrm, uv, j, w, idx, parts = assemble(game, uvs, dressed, normals, joints, amounts)
        if HAIR[name]:
            length, strands, fringe = HAIR[name]
            hp, hn, hu, hj, hw, hi = hair(game, normals, joints, index_of['head'], length, strands, fringe, seed=len(name))
            parts.append({'name': 'hair', 'indexStart': int(len(idx)), 'indexCount': int(len(hi)),
                          'vertexStart': int(len(pos)), 'vertexCount': int(len(hp))})
            idx = np.concatenate([idx, hi + len(pos)])
            pos, nrm, uv = np.concatenate([pos, hp]), np.concatenate([nrm, hn]), np.concatenate([uv, hu])
            j, w = np.concatenate([j, hj]), np.concatenate([w, hw])
        if len(pos) < 65536:
            idx = idx.astype(np.uint16)

        header = {
            'name': name,
            'spec': spec,
            'vertexCount': int(len(pos)),
            'indexCount': int(len(idx)),
            'parts': parts,
            'bones': [{
                'name': b['name'],
                'parent': index_of[b['parent']] if b['parent'] else -1,
                'head': [round(float(x), 5) for x in (to_game(b['head']) - [0, floor, 0])],
                'tail': [round(float(x), 5) for x in (to_game(b['tail']) - [0, floor, 0])],
            } for b in bones],
            'height': round(float(game[:13380, 1].max()), 4),
            'faceless': bool(shape.get('faceless')),
            'source': 'MakeHuman base mesh, default skeleton and weights (CC0)',
        }
        out = OUT / f'{name}.bin'
        write(out, header, [
            ('position', pos), ('normal', nrm), ('uv', uv),
            ('joints', j), ('weights', w), ('index', idx),
        ])
        print(f'{name:6s} {len(pos):6d} verts {len(idx) // 3:6d} tris '
              f'{len(bones):3d} bones  height {header["height"]:.2f}m  '
              f'{out.stat().st_size // 1024}K')


if __name__ == '__main__':
    main()
