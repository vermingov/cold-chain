"""What is inside a body.

    uv run --with numpy tools/organs.py <bodyparts3d> <person.bin> <out.bin>

The organs are BodyParts3D's (dbarchive.biosciencedbc.jp/en/bodyparts3d, (c)
The Database Center for Life Science, CC BY-SA 2.1 Japan): one man, scanned
and segmented into a couple of thousand named parts, a file each. This takes
the parts of the belly, joins the ones that are pieces of one organ, thins
them to something a game can draw, and fits them into one of this game's own
people (tools/people.py), who is somebody else of a different build.

The fit is three stretches, one along each axis of the body, found from
landmarks both have: the hip joints and the top of the breastbone say how
tall, the flanks how wide, and the skin of the belly, front and back, how
deep. Width and depth are only let stretch a little: a stout man's organs
are much the size of a thin one's, and what he has more of is fat in front
of them, so they are fitted against his back and the rest is left empty.
After that nothing is allowed to come through the wall of the abdomen,
front, back or either side: a part of an organ that would lie nearer the
skin than the wall is thick is pressed back in.

The source is in millimetres, z up, front at -y, the man's right at -x. A
person here is in metres, y up, front at +z, their right at +x: so the two
frames are mirror images, and every triangle is turned over on the way.

What the game will have to cut through, the vessels and the ureters, is not
kept as a mesh at all. A tube that is going to be clamped and severed
anywhere along it is better known by its middle line and how thick it is
there, and drawn from that: so those are written as paths.

Output: 'CCOF', u32 version, u32 header length, a JSON header, then the
arrays it names (position, normal: float32 xyz; index: uint32), organ by
organ. Each organ in the header: name, kind, vertexStart, vertexCount,
indexStart, indexCount, centre, bounds; a tube has `path` instead, a list
of [x, y, z, radius], and no corners.
"""

import json
import os
import re
import struct
import sys

import numpy as np

WALL = 0.03         # metres an organ keeps from the skin, front and back
STOUT = 1.12        # the most an organ is stretched, across or through, to suit a bigger body

# The organs of the belly: what each is called here, what kind of thing it is
# (which is what it is drawn as), the source's own names for its pieces, and
# how fine to keep it in millimetres (a kidney is looked at closely; forty
# loops of bowel are not).
ORGANS = [
    ('liver', 'liver', [r'Hepatovenous segment', r'Caudate lobe of liver'], 4.0),
    ('gallbladder', 'gallbladder', [r'Gallbladder'], 2.5),
    ('stomach', 'stomach', [r'Stomach'], 3.5),
    ('spleen', 'spleen', [r'Spleen'], 3.0),
    ('pancreas', 'pancreas', [r'Parenchyma of pancreas'], 3.0),
    ('duodenum', 'bowel', [r'Duodenum'], 3.0),
    ('small bowel', 'bowel', [r'part of jejunum', r'part of ileum'], 3.0),
    ('ascending colon', 'colon', [r'Ascending colon', r'Appendix'], 3.5),
    ('transverse colon', 'colon', [r'Transverse colon'], 3.5),
    ('descending colon', 'colon', [r'Descending colon'], 3.5),
    ('rectum', 'colon', [r'Rectum'], 3.5),
    ('bladder', 'bladder', [r'Urinary bladder'], 2.5),
    ('right kidney', 'kidney', [r'Right kidney'], 1.8),
    ('left kidney', 'kidney', [r'Left kidney'], 1.8),
    ('right adrenal', 'adrenal', [r'Right adrenal gland'], 2.0),
    ('left adrenal', 'adrenal', [r'Left adrenal gland'], 2.0),
    ('aorta', 'artery', [r'Abdominal aorta'], 2.0),
    ('vena cava', 'vein', [r'Inferior vena cava'], 2.0),
    ('right psoas', 'muscle', [r'Right psoas major'], 4.0),
    ('left psoas', 'muscle', [r'Left psoas major'], 4.0),
    ('spine', 'bone', [r'(First|Second|Third|Fourth|Fifth) lumbar vertebra', r'Twelfth thoracic vertebra', r'Sacrum'], 4.0),
    ('pelvis', 'bone', [r'(Right|Left) hip bone'], 4.5),
]


# The tubes: as above, but the last figure is how many millimetres of tube to
# a point of its path. Where the source has the same name on two files (a
# renal vein outside the kidney, and its tree inside), the smaller is the one
# outside.
TUBES = [
    ('right ureter', 'ureter', [r'^Right ureter$'], 9.0),
    ('left ureter', 'ureter', [r'^Left ureter$'], 9.0),
    ('right renal artery', 'artery', [r'^Trunk of right renal artery$'], 6.0),
    ('left renal artery', 'artery', [r'^Trunk of left renal artery$'], 6.0),
    ('right renal vein', 'vein', [r'^Right renal vein$'], 6.0),
    ('left renal vein', 'vein', [r'^Left renal vein$'], 6.0),
]


# --- reading -------------------------------------------------------------------

def index_of(source):
    """Every file's English name, read from its header and remembered."""
    cache = os.path.join(source, 'names.json')
    if os.path.exists(cache):
        return json.load(open(cache))
    names = {}
    folder = os.path.join(source, 'isa_BP3D_4.0_obj_99')
    for file in sorted(os.listdir(folder)):
        with open(os.path.join(folder, file), errors='replace') as lines:
            for n, line in enumerate(lines):
                if line.startswith('# English name'):
                    names[file] = line.split(':', 1)[1].strip()
                if n > 14:
                    break
    json.dump(names, open(cache, 'w'))
    return names


def read_obj(path):
    """Corners and triangles of one file, in the source's millimetres."""
    corners, faces = [], []
    with open(path, errors='replace') as lines:
        for line in lines:
            if line.startswith('v '):
                corners.append(line.split()[1:4])
            elif line.startswith('f '):
                ring = [int(c.split('/')[0]) - 1 for c in line.split()[1:]]
                for i in range(1, len(ring) - 1):
                    faces.append((ring[0], ring[i], ring[i + 1]))
    return np.array(corners, dtype=np.float64), np.array(faces, dtype=np.int64).reshape(-1, 3)


def read_named(source, names, patterns, smallest=False):
    """All the files whose names match any of the patterns, as one mesh; or
    only the smallest of them."""
    folder = os.path.join(source, 'isa_BP3D_4.0_obj_99')
    wanted = [f for f, name in names.items() if any(re.search(p, name) for p in patterns)]
    if not wanted:
        raise SystemExit(f'nothing in the source is called {patterns}')
    if smallest:
        wanted = [min(wanted, key=lambda f: os.path.getsize(os.path.join(folder, f)))]
    corners, faces, base = [], [], 0
    for file in wanted:
        v, f = read_obj(os.path.join(folder, file))
        corners.append(v)
        faces.append(f + base)
        base += len(v)
    return np.concatenate(corners), np.concatenate(faces)


def read_person(path):
    """A person as tools/people.py wrote them: header and arrays."""
    data = open(path, 'rb').read()
    if data[:4] != b'CCPF':
        raise SystemExit(f'{path}: not a person')
    length = struct.unpack('<I', data[8:12])[0]
    header = json.loads(data[12:12 + length])
    kinds = {'float32': np.float32, 'uint8': np.uint8, 'uint16': np.uint16, 'uint32': np.uint32}
    arrays = {a['name']: np.frombuffer(data, dtype=kinds[a['type']], count=a['length'] // np.dtype(kinds[a['type']]).itemsize,
                                       offset=12 + length + a['offset']) for a in header['arrays']}
    return header, arrays


# --- the fit -------------------------------------------------------------------

def skin_of(header, arrays):
    """The person's skin: corners (n, 3) and triangles."""
    corners = arrays['position'].reshape(-1, 3).astype(np.float64)
    faces = np.concatenate([arrays['index'][p['indexStart']:p['indexStart'] + p['indexCount']] for p in header['parts'] if p['kind'] == 'skin'])
    return corners, faces.reshape(-1, 3).astype(np.int64)


def belly(corners, up, deep, across, low, high, front_sign):
    """How far forward and back the trunk's surface is near its midline, at
    three heights between `low` and `high`: [(front, back), ...]."""
    out = []
    for share in (0.25, 0.45, 0.65):
        level = low + (high - low) * share
        band = corners[(np.abs(corners[:, up] - level) < (high - low) * 0.04) & (np.abs(corners[:, across]) < (high - low) * 0.09)]
        depths = band[:, deep] * front_sign
        out.append((depths.max() * front_sign, depths.min() * front_sign))
    return out


def flank(corners, up, across, low, high):
    """Half the width of the trunk at the waist: going out from the midline,
    where the skin stops before the arm starts."""
    found = []
    for share in (0.35, 0.45, 0.55):
        level = low + (high - low) * share
        out = np.sort(np.abs(corners[np.abs(corners[:, up] - level) < (high - low) * 0.02][:, across]))
        gaps = np.where(np.diff(out) > (high - low) * 0.035)[0]
        found.append(out[gaps[0]] if len(gaps) else out[-1])
    return float(np.median(found))


def fit(source, names, header, arrays):
    """The three stretches that carry a point of the source into the person:
    returns a function from (n, 3) millimetres to (n, 3) metres."""
    # The source's landmarks: the heads of the thigh bones, the top of the breastbone.
    hips = []
    for side in ('Right femur', 'Left femur'):
        v, _ = read_named(source, names, [side + '$'])
        head = v[v[:, 2] > v[:, 2].max() - 45]
        # The head is the half of the top of the bone nearer the middle of the body.
        inner = head[np.abs(head[:, 0]) < np.median(np.abs(head[:, 0]))]
        hips.append(inner.mean(axis=0))
    notch_v, _ = read_named(source, names, [r'^Manubrium$'])
    their = {'hips': np.mean(hips, axis=0), 'notch': notch_v[:, 2].max()}
    skin_v, _ = read_named(source, names, [r'^Skin$'])
    their['belly'] = belly(skin_v, 2, 1, 0, their['hips'][2], their['notch'], -1)
    their['flank'] = flank(skin_v, 2, 0, their['hips'][2], their['notch'])

    # The person's: the same joints, from their skeleton, and their own skin.
    bones = {b['name']: b for b in header['bones']}
    left, right = np.array(bones['upperleg01.L']['head']), np.array(bones['upperleg01.R']['head'])
    notch = (np.array(bones['clavicle.L']['head']) + np.array(bones['clavicle.R']['head'])) / 2
    ours = {'hips': (left + right) / 2, 'notch': notch[1]}
    corners, _ = skin_of(header, arrays)
    ours['belly'] = belly(corners, 1, 2, 0, ours['hips'][1], ours['notch'], 1)
    ours['flank'] = flank(corners, 1, 0, ours['hips'][1], ours['notch'])

    tall = (ours['notch'] - ours['hips'][1]) / (their['notch'] - their['hips'][2])
    wide = min(STOUT / 1000, ours['flank'] / their['flank'])
    # Depth is measured from the back, which is where the organs lie.
    front, back = np.mean(their['belly'], axis=0)
    our_front, our_back = np.mean(ours['belly'], axis=0)
    deep = min(STOUT / 1000, (our_front - our_back) / (back - front))
    print(f'fit: {tall * 1000:.3f} tall, {wide * 1000:.3f} wide, {deep * 1000:.3f} deep (metres to their metre); '
          f'their trunk {their["flank"] * 2:.0f} x {back - front:.0f} mm, ours {ours["flank"] * 2000:.0f} x {(our_front - our_back) * 1000:.0f} mm')

    def carry(points):
        out = np.empty_like(points)
        out[:, 0] = ours['hips'][0] - (points[:, 0] - their['hips'][0]) * wide
        out[:, 1] = ours['hips'][1] + (points[:, 2] - their['hips'][2]) * tall
        out[:, 2] = our_back + (back - points[:, 1]) * deep
        return out
    return carry


def walls(header, arrays, cell=0.008, along=2, over=(0, 1)):
    """Where the person's skin is on either side along axis `along`, over a
    grid of the other two (`over`): by default their front and back, over
    their trunk seen from the front. Returns a function from (n, 3) to the
    (highest, lowest) value along that axis at each point's place."""
    corners, faces = skin_of(header, arrays)
    a, b = over
    x0, y0 = corners[:, a].min(), corners[:, b].min()
    w, h = int((corners[:, a].max() - x0) / cell) + 2, int((corners[:, b].max() - y0) / cell) + 2
    front, back = np.full((h, w), -np.inf), np.full((h, w), np.inf)
    # Every triangle is dropped into the grid as a spread of points across
    # it, close enough together that no cell under a triangle is missed: a
    # cell that only ever caught the back of the body would say the front
    # was there too.
    tri = corners[faces]
    steps = 9
    spread = [(a / steps, b / steps) for a in range(steps + 1) for b in range(steps + 1 - a)]
    samples = np.concatenate([tri[:, 0] * (1 - a - b) + tri[:, 1] * a + tri[:, 2] * b for a, b in spread])
    i = ((samples[:, a] - x0) / cell).astype(int)
    j = ((samples[:, b] - y0) / cell).astype(int)
    np.maximum.at(front, (j, i), samples[:, along])
    np.minimum.at(back, (j, i), samples[:, along])
    # Fill the cells nothing fell in from their neighbours.
    for grid, worst in ((front, -np.inf), (back, np.inf)):
        for _ in range(4):
            empty = grid == worst
            spread = np.stack([np.roll(grid, s, axis=a) for a in (0, 1) for s in (1, -1)])
            known = spread != worst
            near = np.where(known, spread, 0).sum(axis=0) / np.maximum(known.sum(axis=0), 1)
            fill = empty & known.any(axis=0)
            grid[fill] = near[fill]
        # Where there is still no skin there is no wall to keep clear of.
        grid[grid == worst] = -worst

    def at(points):
        i = np.clip(((points[:, a] - x0) / cell).astype(int), 0, w - 1)
        j = np.clip(((points[:, b] - y0) / cell).astype(int), 0, h - 1)
        return front[j, i], back[j, i]
    return at


# --- thinning ------------------------------------------------------------------

def thin(corners, faces, cell):
    """Fewer corners: all that fall in one cell of a grid become one, at
    their middle. Triangles that collapse are dropped."""
    keys = np.floor(corners / cell).astype(np.int64)
    _, where, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    where = where.reshape(-1)
    merged = np.zeros((len(counts), 3))
    np.add.at(merged, where, corners)
    merged /= counts[:, None]
    faces = where[faces]
    faces = faces[(faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 2] != faces[:, 0])]
    # And the ones that have become the same triangle twice.
    first = np.unique(np.sort(faces, axis=1), axis=0, return_index=True)[1]
    return merged, faces[np.sort(first)]


def normals_of(corners, faces):
    tri = corners[faces]
    face = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    out = np.zeros_like(corners)
    for k in range(3):
        np.add.at(out, faces[:, k], face)
    length = np.linalg.norm(out, axis=1, keepdims=True)
    return out / np.where(length == 0, 1, length)


def middle_line(corners, every):
    """The path down the middle of a tube: its corners are sorted along the
    way it mostly runs, cut into lengths of `every` metres, and each length
    gives one point (its middle) and one radius (how far its corners are
    from that)."""
    centre = corners.mean(axis=0)
    runs = np.linalg.svd(corners - centre, full_matrices=False)[2][0]
    along = (corners - centre) @ runs
    path = []
    for start in np.arange(along.min(), along.max(), every):
        ring = corners[(along >= start) & (along < start + every)]
        if len(ring) < 3:
            continue
        middle = ring.mean(axis=0)
        path.append([*middle, max(0.0012, float(np.linalg.norm(ring - middle, axis=1).mean()))])
    path = np.array(path)
    # A tube does not jink from one length to the next: ease each point toward its neighbours.
    for _ in range(2):
        path[1:-1, :3] = (path[:-2, :3] + 2 * path[1:-1, :3] + path[2:, :3]) / 4
    return path


# --- main ----------------------------------------------------------------------

def main():
    source, person, out = sys.argv[1:4]
    names = index_of(source)
    header, arrays = read_person(person)
    carry = fit(source, names, header, arrays)
    wall_at = walls(header, arrays)
    # And either side: seen from above, how far out to the left and right the skin is at each height and depth.
    side_at = walls(header, arrays, along=0, over=(2, 1))

    positions, normals, indices, organs = [], [], [], []
    v_base = i_base = 0
    print(f'{"organ":20} {"corners":>8} {"triangles":>10}  pressed in')
    for name, kind, patterns, cell in ORGANS:
        corners, faces = read_named(source, names, patterns)
        corners, faces = thin(corners, faces, cell)
        corners = carry(corners)
        front, back = wall_at(corners)
        limit_front, limit_back = front - WALL, back + WALL
        pressed = int(((corners[:, 2] > limit_front) | (corners[:, 2] < limit_back)).sum())
        corners[:, 2] = np.maximum(np.minimum(corners[:, 2], limit_front), np.minimum(limit_back, limit_front))
        # The flanks too: the crest of a wide pelvis came out through a narrow man's side.
        outer, inner = side_at(corners)
        limit_out, limit_in = outer - WALL, inner + WALL
        pressed += int(((corners[:, 0] > limit_out) | (corners[:, 0] < limit_in)).sum())
        corners[:, 0] = np.maximum(np.minimum(corners[:, 0], limit_out), np.minimum(limit_in, limit_out))
        # The mirror turned every triangle inside out: turn them back. The
        # normals are taken first, from the triangles as they were: in a
        # left-handed frame that is the way that comes out pointing outward.
        outward = normals_of(corners, faces)
        faces = faces[:, ::-1]
        organs.append({
            'name': name, 'kind': kind, 'vertexStart': v_base, 'vertexCount': len(corners), 'indexStart': i_base, 'indexCount': faces.size,
            'centre': corners.mean(axis=0).round(4).tolist(), 'bounds': [corners.min(axis=0).round(4).tolist(), corners.max(axis=0).round(4).tolist()],
        })
        positions.append(corners.astype(np.float32))
        normals.append(outward.astype(np.float32))
        indices.append((faces + v_base).astype(np.uint32))
        print(f'{name:20} {len(corners):8} {len(faces):10}  {pressed}')
        v_base += len(corners)
        i_base += faces.size

    for name, kind, patterns, every in TUBES:
        corners, _ = read_named(source, names, patterns, smallest=True)
        path = middle_line(carry(corners), every / 1000)
        organs.append({'name': name, 'kind': kind, 'path': path.round(4).tolist()})
        print(f'{name:20} a path of {len(path)}, {np.linalg.norm(np.diff(path[:, :3], axis=0), axis=1).sum() * 1000:.0f} mm long, about {path[:, 3].mean() * 2000:.1f} mm thick')

    blobs = {'position': np.concatenate(positions).tobytes(), 'normal': np.concatenate(normals).tobytes(), 'index': np.concatenate(indices).tobytes()}
    kinds = {'position': 'float32', 'normal': 'float32', 'index': 'uint32'}
    listed, offset = [], 0
    for key, blob in blobs.items():
        listed.append({'name': key, 'type': kinds[key], 'offset': offset, 'length': len(blob)})
        offset += len(blob)
    head = json.dumps({
        'body': header['name'], 'organs': organs, 'arrays': listed,
        'source': 'BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan',
    }).encode()
    head += b' ' * (-len(head) % 4)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'wb') as f:
        f.write(b'CCOF' + struct.pack('<II', 1, len(head)) + head + b''.join(blobs.values()))
    print(f'{out}: {v_base} corners, {i_base // 3} triangles, {os.path.getsize(out) // 1024}K')


if __name__ == '__main__':
    main()
