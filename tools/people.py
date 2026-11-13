#!/usr/bin/env python3
"""The people: the dead on the table and the living at the gate.

Builds every person in the game out of MakeHuman, all of which MakeHuman
publishes as CC0: the base mesh pushed through its own macro targets (sex,
age, muscle, weight, height), its skeleton and skin weights, and then the
things that make a body somebody: a photographed skin, real eyes, brows,
lashes, teeth, a tongue, hair, and clothes. The clothes and the hair are
MakeHuman "proxies": meshes whose every vertex is tied to three vertices of
the base mesh, so they follow whatever body they are put on.

    uv run --with numpy --with pillow tools/people.py <makehuman data> <base assets>

`<makehuman data>` is `makehuman/data` from github.com/makehumancommunity/
makehuman (3dobjs, rigs, targets/macrodetails). `<base assets>` is a mirror of
download.tuxfamily.org/makehuman/assets/1.2/base (skins, clothes, hair, eyes,
eyebrows, eyelashes, teeth, tongue).

Output: assets/people/<name>.bin, read by src/person.js, and the textures it
names under assets/people/tex/. The format is a JSON header followed by raw
little-endian arrays, because the only reader is ours.

Coordinates go from MakeHuman's (right-handed, decimetres, facing +Z) to
Babylon's (left-handed, metres) by mirroring X, which keeps a person facing
+Z with their own left at -X and turns MakeHuman's counter-clockwise
triangles into the clockwise ones Babylon draws, so indices go out in their
original order.
"""

import json
import os
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(os.environ.get('PEOPLE_OUT', Path(__file__).resolve().parent.parent / 'assets' / 'people'))

# --- the cast ---------------------------------------------------------------
#
# `body` is MakeHuman's own sliders, 0..1 with 0.5 as the average. `wears` is
# what they were buried or turned up in: on the table it comes off, and the
# skin under it is kept as a part of its own so it can be drawn then and not
# before (drawn under cloth it pokes through at every bend).

CAST = {
    # Night one. Seventy-eight, a pauper's plot, the suit he owned.
    'oldman': {
        'body': {'gender': 0.92, 'age': 0.93, 'muscle': 0.22, 'weight': 0.38, 'height': 0.48},
        'skin': 'old_caucasian_male', 'eyes': 'bluegreen', 'brows': 'eyebrow006', 'lashes': 'eyelashes01',
        'hair': 'short04', 'wears': ['male_elegantsuit01', 'shoes02'],
    },
    # The buyer who does the talking.
    'buyer': {
        'body': {'gender': 0.9, 'age': 0.62, 'muscle': 0.5, 'weight': 0.6, 'height': 0.6},
        'skin': 'middleage_caucasian_male', 'eyes': 'brown', 'brows': 'eyebrow003', 'lashes': 'eyelashes01',
        'hair': 'short02', 'wears': ['male_casualsuit04', 'shoes04'],
    },
    # The sexton, who lives at the gate.
    'sexton': {
        'body': {'gender': 0.95, 'age': 0.8, 'muscle': 0.45, 'weight': 0.55, 'height': 0.42},
        'skin': 'old_caucasian_male', 'eyes': 'brown', 'brows': 'eyebrow010', 'lashes': 'eyelashes01',
        'hair': 'short01', 'wears': ['male_worksuit01', 'shoes05'],
    },
    # The sandbox's young man in a hood: early twenties, a dark green hooded sweat jacket over a dark T-shirt and
    # jeans, a black knitted beanie pushed back on short dark hair. The jacket and beanie are from the MakeHuman
    # community packs shirts02 and hats03 (Elvaerwyn, CC-BY), copied into <base assets>/clothes; `tint` recolours a
    # garment's texture (sRGB 0..255).
    'hood': {
        'body': {'gender': 0.97, 'age': 0.44, 'muscle': 0.45, 'weight': 0.62, 'height': 0.52},
        'skin': 'young_caucasian_male', 'eyes': 'brown', 'brows': 'eyebrow003', 'lashes': 'eyelashes01',
        'hair': 'short02', 'wears': ['male_casualsuit02', 'elvs_hooded_sweat_jacket1', 'shoes04', 'elvs_slouchy_beanie1'],
        'tint': {'male_casualsuit02': [30, 30, 33], 'elvs_hooded_sweat_jacket1': [30, 46, 31], 'elvs_slouchy_beanie1': [21, 21, 23]},
        # The beanie pulled down and forward over the hair, and a little fuller so the hair stays under it.
        # The jacket a little looser than it was cut, so the T-shirt under it never comes through at a bend.
        'adjust': {'elvs_slouchy_beanie1': {'inflate': 0.012, 'shift': [0, -0.022, 0.014]}, 'elvs_hooded_sweat_jacket1': {'inflate': 0.009}},
    },
}

# --- skeleton ---------------------------------------------------------------
#
# MakeHuman's default rig has 163 bones. The game animates about seventy: the
# spine, limbs and fingers, the jaw, the eyes and eyelids, and the two
# muscles that pull the corners of the mouth. Every other bone hands its
# weights up to its nearest kept ancestor.

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

DM = 0.1   # MakeHuman works in decimetres

# How large each kind of texture is kept, on its longer side.
TEXTURE_SIZE = {'skin': 2048, 'cloth': 1024, 'hair': 1024, 'eyes': 512, 'brows': 512, 'lashes': 512, 'teeth': 512, 'tongue': 256}


# --- reading MakeHuman's files -------------------------------------------------

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
                              [int(c[1]) - 1 if len(c) > 1 and c[1] else 0 for c in corners]))
    return np.array(verts), np.array(uvs if uvs else [[0.0, 0.0]]), faces


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


def read_settings(path):
    """The `key value...` lines of a .mhmat or the head of a .mhclo."""
    out = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            key, _, value = line.partition(' ')
            out.setdefault(key, value.strip())
    return out


def read_proxy(path):
    """A .mhclo: where its mesh is, how it scales with the body, and for each
    of its vertices the three base vertices it hangs from, their weights and
    an offset. `delete` is the base vertices it covers completely."""
    settings = read_settings(path)
    scales, binds, delete = {}, [], set()
    mode = None
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            words = line.split()
            if words[0] in ('x_scale', 'y_scale', 'z_scale'):
                scales[words[0][0]] = (int(words[1]), int(words[2]), float(words[3]))
            elif words[0] == 'verts':
                mode = 'verts'
            elif words[0] == 'delete_verts':
                mode = 'delete'
            elif not (words[0][0].isdigit() or words[0][0] == '-'):
                # A setting. They turn up in the middle of the vertex list
                # in some files, and do not end it.
                continue
            elif mode == 'verts':
                if len(words) == 1:
                    binds.append(((int(words[0]),) * 3, (1.0, 0.0, 0.0), (0.0, 0.0, 0.0)))
                else:
                    binds.append((tuple(int(w) for w in words[0:3]),
                                  tuple(float(w) for w in words[3:6]),
                                  tuple(float(w) for w in words[6:9])))
            elif mode == 'delete':
                i = 0
                while i < len(words):
                    if i + 2 < len(words) and words[i + 1] == '-':
                        delete.update(range(int(words[i]), int(words[i + 2]) + 1))
                        i += 3
                    else:
                        delete.add(int(words[i]))
                        i += 1
    folder = path.parent
    material = read_settings(folder / settings['material']) if 'material' in settings else {}
    texture = (folder / settings['material']).parent / material['diffuseTexture'] if 'diffuseTexture' in material else None
    return {'obj': folder / settings['obj_file'], 'scales': scales, 'binds': binds, 'delete': delete, 'texture': texture}


# --- MakeHuman's macro modifier, reduced to what the cast uses -----------------

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
        out.append({'name': name, 'parent': kept_ancestor(b['parent']),
                    'head': joints[b['head']], 'tail': joints[b['tail']]})
    remap = {name: kept_ancestor(name) for name in bones}
    return out, remap


def base_weights(weights_json, remap, index_of, count):
    """For every base vertex, {bone index: weight}."""
    per_vertex = [dict() for _ in range(count)]
    for bone, pairs in weights_json.items():
        target = index_of[remap[bone]]
        for v, w in pairs:
            d = per_vertex[v]
            d[target] = d.get(target, 0.0) + w
    return per_vertex


def quantise(per_vertex):
    """The four heaviest bones of each vertex, as bytes that add to 255."""
    joints = np.zeros((len(per_vertex), 4), dtype=np.uint8)
    amounts = np.zeros((len(per_vertex), 4), dtype=np.uint8)
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


# --- fitting a proxy to a body ---------------------------------------------------

def fit(proxy, body, weights):
    """Put a proxy on a body: where each of its vertices lands, and which
    bones carry it, both blended from the three base vertices it hangs from."""
    scale = np.ones(3)
    for axis, (a, b, denominator) in proxy['scales'].items():
        k = 'xyz'.index(axis)
        scale[k] = abs(body[a][k] - body[b][k]) / denominator
    pos = np.zeros((len(proxy['binds']), 3))
    carried = []
    for i, (vs, ws, offset) in enumerate(proxy['binds']):
        pos[i] = sum(w * body[v] for v, w in zip(vs, ws)) + np.array(offset) * scale
        blend = {}
        for v, w in zip(vs, ws):
            for bone, amount in weights[v].items():
                blend[bone] = blend.get(bone, 0.0) + max(0.0, w) * amount
        carried.append(blend)
    return pos, carried


# --- mesh --------------------------------------------------------------------

def to_game(p):
    """MakeHuman decimetres, right-handed -> Babylon metres, left-handed."""
    q = np.array(p, dtype=np.float64) * DM
    q[..., 0] *= -1
    return q


def smooth_normals(pos, faces):
    """Area-weighted vertex normals. Seen with the mirrored positions and the
    original winding every one of them points inward, so they are turned."""
    n = np.zeros_like(pos)
    for _, vs, _ in faces:
        p = pos[vs]
        for a, b, c in ((0, 1, 2), (0, 2, 3)) if len(vs) == 4 else ((0, 1, 2),):
            fn = np.cross(p[b] - p[a], p[c] - p[a])
            for k in (a, b, c):
                n[vs[k]] += fn
    lens = np.linalg.norm(n, axis=1, keepdims=True)
    lens[lens == 0] = 1
    return -n / lens


class Mesh:
    """Everything a person is drawn from, part by part, in one set of arrays."""

    def __init__(self):
        self.pos, self.nrm, self.uv, self.joints, self.amounts, self.index = [], [], [], [], [], []
        self.parts = []

    def add(self, name, pos, uvs, faces, joints, amounts, **material):
        """One part: vertices are split wherever a UV seam runs through them."""
        normals = smooth_normals(pos, faces)
        remap = {}
        start_i, start_v = len(self.index), len(self.pos)
        for _, vs, ts in faces:
            local = []
            for v, t in zip(vs, ts):
                if (v, t) not in remap:
                    remap[(v, t)] = len(self.pos)
                    self.pos.append(pos[v])
                    self.nrm.append(normals[v])
                    self.uv.append(uvs[t])
                    self.joints.append(joints[v])
                    self.amounts.append(amounts[v])
                local.append(remap[(v, t)])
            for a, b, c in ((0, 1, 2), (0, 2, 3)) if len(local) == 4 else ((0, 1, 2),):
                self.index += [local[a], local[b], local[c]]
        self.parts.append({
            'name': name, **material,
            'indexStart': start_i, 'indexCount': len(self.index) - start_i,
            'vertexStart': start_v, 'vertexCount': len(self.pos) - start_v,
        })


# --- textures ------------------------------------------------------------------

def natural_iris(image):
    """MakeHuman's irises are painted at full saturation: its brown is nearly pure red (65, 14, 5), and the game's
    grade makes it a red eye. The iris (everything saturated) is taken to half its saturation, and a red-brown is
    turned a little toward yellow, to the dark brown of a real one; the white and the pupil are left."""
    rgba = image.convert('RGBA')
    hsv = np.asarray(rgba.convert('RGB').convert('HSV')).astype(np.float32)
    iris = hsv[..., 1] > 90
    reddish = iris & (hsv[..., 0] < 20)
    hsv[..., 0] = np.where(reddish, hsv[..., 0] + 7, hsv[..., 0])
    hsv[..., 1] = np.where(iris, hsv[..., 1] * 0.55, hsv[..., 1])
    hsv[..., 2] = np.where(iris, np.minimum(255, hsv[..., 2] * 1.1), hsv[..., 2])
    out = Image.fromarray(hsv.astype(np.uint8), 'HSV').convert('RGB')
    out.putalpha(rgba.getchannel('A'))
    return out if image.mode == 'RGBA' else out.convert('RGB')


def texture(src, kind, done, tint=None):
    """Copy a texture into the game at the size its kind is kept at, once.
    Anything with see-through in it stays a PNG; a skin is a JPEG.
    With `tint` the picture is recoloured: its typical (median) shade made that colour, lighter and darker shades kept
    lighter and darker but softened (a jacket's texture can be nearly all one dark with white cords and stitching)."""
    if src is None:
        return None
    key = (src, tuple(tint) if tint else None)
    if key in done:
        return done[key]
    image = Image.open(src)
    if kind == 'eyes':
        image = natural_iris(image)
    if tint:
        grey = np.asarray(image.convert('L'), dtype=np.float32)
        shade = np.minimum(3.2, 0.6 + 0.4 * grey / max(1.0, float(np.median(grey))))
        rgb = np.clip(shade[..., None] * np.array(tint, dtype=np.float32), 0, 255).astype(np.uint8)
        tinted = Image.fromarray(rgb, 'RGB')
        if image.mode in ('RGBA', 'LA'):
            tinted.putalpha(image.getchannel('A'))
        image = tinted
    limit = TEXTURE_SIZE[kind]
    if max(image.size) > limit:
        image = image.resize([round(s * limit / max(image.size)) for s in image.size], Image.LANCZOS)
    alpha = image.mode in ('RGBA', 'LA') and image.getchannel('A').getextrema()[0] < 250
    name = src.stem + ('-' + '-'.join(map(str, tint)) if tint else '') + ('.png' if alpha else '.jpg')
    (OUT / 'tex').mkdir(parents=True, exist_ok=True)
    if alpha:
        image.save(OUT / 'tex' / name, optimize=True)
    else:
        image.convert('RGB').save(OUT / 'tex' / name, quality=88)
    done[key] = {'file': 'tex/' + name, 'alpha': alpha}
    return done[key]


def write(path, header, arrays):
    blobs, layout, offset = [], [], 0
    for name, arr in arrays:
        raw = np.ascontiguousarray(arr).tobytes()
        pad = (-len(raw)) % 4
        layout.append({'name': name, 'offset': offset, 'length': len(raw), 'type': str(arr.dtype)})
        blobs.append(raw + b'\0' * pad)
        offset += len(raw) + pad
    head = json.dumps(dict(header, arrays=layout), separators=(',', ':')).encode()
    head += b' ' * ((-len(head)) % 4)
    with open(path, 'wb') as fh:
        fh.write(b'CCPF')
        fh.write(struct.pack('<II', 1, len(head)))
        fh.write(head)
        for b in blobs:
            fh.write(b)


# --- one person ----------------------------------------------------------------

def proxy_path(assets, kind, name):
    folder = assets / kind / name
    found = sorted(folder.glob('*.mhclo'))
    if not found:
        raise SystemExit(f'no proxy in {folder}')
    return found[0]


def build(name, spec, base, data, assets, cache, textures):
    verts, uvs, faces = base
    body = build_body(verts, data / 'targets' / 'macrodetails', spec['body'], cache)
    bones, remap = skeleton(cache['skel'], body)
    index_of = {b['name']: i for i, b in enumerate(bones)}
    weights = base_weights(cache['weights'], remap, index_of, len(body))
    joints, amounts = quantise(weights)

    skin_faces = [f for f in faces if f[0] == 'body']
    game = to_game(body)
    floor = min(game[v][1] for _, vs, _ in skin_faces for v in vs)
    game[:, 1] -= floor
    height = max(game[v][1] for _, vs, _ in skin_faces for v in vs)

    worn = [read_proxy(proxy_path(assets, 'clothes', w)) for w in spec['wears']]
    covered = set().union(*[p['delete'] for p in worn]) if worn else set()
    under = [f for f in skin_faces if all(v in covered for v in f[1])]
    shown = [f for f in skin_faces if not all(v in covered for v in f[1])]

    skin_mat = read_settings(assets / 'skins' / spec['skin'] / f"{spec['skin']}.mhmat")
    skin_tex = texture(assets / 'skins' / spec['skin'] / skin_mat['diffuseTexture'], 'skin', textures)

    mesh = Mesh()
    mesh.add('skin', game, uvs, shown, joints, amounts, kind='skin', texture=skin_tex)
    if under:
        mesh.add('skin-under', game, uvs, under, joints, amounts, kind='skin', texture=skin_tex, under=True)

    body_normals = smooth_normals(game, faces)

    def proxy(part, kind, path, image=None, tint=None, adjust=None, **extra):
        p = read_proxy(path)
        pos, carried = fit(p, body, weights)
        pv, puv, pf = read_obj(p['obj'])
        if len(pv) != len(pos):
            raise SystemExit(f'{path}: {len(pv)} vertices in the mesh, {len(pos)} bound')
        g = to_game(pos)
        g[:, 1] -= floor
        if adjust:
            # Worn otherwise than its maker fitted it: pushed out from the body under it (along the body's own surface,
            # so a thin cord moves out whole rather than swelling), then moved (metres, the game's frame).
            out = np.array([sum(w * body_normals[v] for v, w in zip(vs, ws)) for vs, ws, _ in p['binds']])
            out /= np.maximum(np.linalg.norm(out, axis=1, keepdims=True), 1e-9)
            g = g + out * adjust.get('inflate', 0) + np.array(adjust.get('shift', [0, 0, 0]))
        pj, pa = quantise(carried)
        mesh.add(part, g, puv, pf, pj, pa, kind=kind, texture=texture(image or p['texture'], kind, textures, tint), **extra)

    iris = assets / 'eyes' / 'materials' / f"{spec['eyes']}_eye.png"
    # The eyeballs ship with MakeHuman itself; only their irises are in the assets.
    proxy('eyes', 'eyes', proxy_path(data, 'eyes', 'high-poly'), image=iris if iris.exists() else None)
    proxy('teeth', 'teeth', proxy_path(assets, 'teeth', 'teeth_base'))
    proxy('tongue', 'tongue', proxy_path(assets, 'tongue', 'tongue01'))
    proxy('brows', 'brows', proxy_path(assets, 'eyebrows', spec['brows']))
    proxy('lashes', 'lashes', proxy_path(assets, 'eyelashes', spec['lashes']))
    if spec.get('hair'):
        proxy('hair', 'hair', proxy_path(assets, 'hair', spec['hair']))
    for w in spec['wears']:
        proxy('wears:' + w, 'cloth', proxy_path(assets, 'clothes', w), tint=spec.get('tint', {}).get(w), adjust=spec.get('adjust', {}).get(w), worn=True)

    pos = np.array(mesh.pos, dtype=np.float32)
    idx = np.array(mesh.index, dtype=np.uint32)
    if len(pos) < 65536:
        idx = idx.astype(np.uint16)
    header = {
        'name': name,
        'spec': spec['body'],
        'vertexCount': int(len(pos)),
        'indexCount': int(len(idx)),
        'parts': mesh.parts,
        'bones': [{
            'name': b['name'],
            'parent': index_of[b['parent']] if b['parent'] else -1,
            'head': [round(float(x), 5) for x in (to_game(b['head']) - [0, floor, 0])],
            'tail': [round(float(x), 5) for x in (to_game(b['tail']) - [0, floor, 0])],
        } for b in bones],
        'height': round(float(height), 4),
        'source': 'MakeHuman base mesh, skeleton, weights and base assets (CC0)',
    }
    out = OUT / f'{name}.bin'
    write(out, header, [
        ('position', pos), ('normal', np.array(mesh.nrm, dtype=np.float32)),
        ('uv', np.array(mesh.uv, dtype=np.float32)),
        ('joints', np.array(mesh.joints, dtype=np.uint8)), ('weights', np.array(mesh.amounts, dtype=np.uint8)),
        ('index', idx),
    ])
    print(f'{name:8s} {len(pos):6d} verts {len(idx) // 3:6d} tris {len(mesh.parts):2d} parts  '
          f'height {height:.2f}m  {out.stat().st_size // 1024}K')


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    data, assets = Path(sys.argv[1]), Path(sys.argv[2])
    only = sys.argv[3:]
    base = read_obj(data / '3dobjs' / 'base.obj')
    cache = {
        'skel': json.loads((data / 'rigs' / 'default.mhskel').read_text()),
        'weights': json.loads((data / 'rigs' / 'default_weights.mhw').read_text())['weights'],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    textures = {}
    for name, spec in CAST.items():
        if only and name not in only:
            continue
        build(name, spec, base, data, assets, cache, textures)


if __name__ == '__main__':
    main()
