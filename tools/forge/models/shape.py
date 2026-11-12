"""Meshes built face by face, in metres, on Blender's axes (z up).

A `Shape` collects faces, each with the name of its material, and turns them into one Blender object. Every face
is given the way it looks (or is a side of a solid whose middle is known), so the winding is always right. Texture
coordinates are laid flat on each face in metres, so brick courses run level on every wall and up every slope,
and the joins between coplanar faces do not show.
"""

import math

import bmesh
import bpy
from mathutils import Vector

UP = Vector((0, 0, 1))


class Frame:
    """A place on a face: its origin, the way right along it, the way out of it. `at(x, y, d)` is x along, y up the
    face and d out of it."""

    def __init__(self, origin, right, out):
        self.origin = Vector(origin)
        self.right = Vector(right).normalized()
        self.out = Vector(out).normalized()
        self.up = self.out.cross(self.right).normalized()

    def at(self, x, y, d=0.0):
        return self.origin + self.right * x + self.up * y + self.out * d

    def moved(self, x=0.0, y=0.0, d=0.0):
        return Frame(self.at(x, y, d), self.right, self.out)


def newell(points):
    n = Vector((0, 0, 0))
    for a, b in zip(points, points[1:] + points[:1]):
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


class Shape:
    def __init__(self):
        self.verts = []
        self.faces = []         # (vertex indices, material, smooth)

    def face(self, points, material, toward=None, smooth=False):
        """A flat face; `toward` is a direction it should look, or None to keep the order given (counter-clockwise
        seen from outside)."""
        points = [Vector(p) for p in points]
        if toward is not None and newell(points).dot(Vector(toward)) < 0:
            points.reverse()
        start = len(self.verts)
        self.verts.extend(points)
        self.faces.append((tuple(range(start, start + len(points))), material, smooth))

    def block(self, frame, x, y, d, material, skip=()):
        """A box in a frame, from x[0] to x[1] along, y up, d out. `skip` leaves out sides: 'left', 'right',
        'bottom', 'top', 'back', 'front'."""
        corners = {(i, j, k): frame.at(x[i], y[j], d[k]) for i in (0, 1) for j in (0, 1) for k in (0, 1)}
        sides = {
            'left': ([(0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)], -frame.right),
            'right': ([(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)], frame.right),
            'bottom': ([(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)], -frame.up),
            'top': ([(0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)], frame.up),
            'back': ([(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)], -frame.out),
            'front': ([(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)], frame.out),
        }
        for name, (keys, toward) in sides.items():
            if name not in skip:
                self.face([corners[k] for k in keys], material, toward)

    def box(self, lo, hi, material, skip=()):
        """An axis-aligned box from corner `lo` to corner `hi` (front is -y, the street side)."""
        self.block(Frame((0, 0, 0), (1, 0, 0), (0, -1, 0)), (lo[0], hi[0]), (lo[2], hi[2]), (-hi[1], -lo[1]),
                   material, skip)

    def extrude(self, frame, profile, x0, x1, material, caps=True, smooth=False):
        """A section `profile` [(d out, y up), ...] (a closed outline, either way round) run along the frame from x0
        to x1, as a moulding, a gutter, a sill or a coping is."""
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(profile, profile[1:] + profile[:1]))
        turn = 1 if area > 0 else -1
        for a, b in zip(profile, profile[1:] + profile[:1]):
            edge = (b[0] - a[0], b[1] - a[1])
            outward = frame.out * (edge[1] * turn) - frame.up * (edge[0] * turn)
            self.face([frame.at(x0, a[1], a[0]), frame.at(x1, a[1], a[0]), frame.at(x1, b[1], b[0]),
                       frame.at(x0, b[1], b[0])], material, outward, smooth)
        if caps:
            self.face([frame.at(x0, y, d) for d, y in profile], material, -frame.right)
            self.face([frame.at(x1, y, d) for d, y in profile], material, frame.right)

    def prism(self, plan, z0, z1, material, caps=(True, True)):
        """A vertical prism over a convex plan [(x, y), ...]."""
        middle = Vector((sum(p[0] for p in plan) / len(plan), sum(p[1] for p in plan) / len(plan), 0))
        for a, b in zip(plan, plan[1:] + plan[:1]):
            side = [Vector((a[0], a[1], z0)), Vector((b[0], b[1], z0)), Vector((b[0], b[1], z1)),
                    Vector((a[0], a[1], z1))]
            self.face(side, material, (side[0] + side[1]) / 2 - Vector((middle.x, middle.y, z0)))
        if caps[0]:
            self.face([Vector((x, y, z0)) for x, y in plan], material, -UP)
        if caps[1]:
            self.face([Vector((x, y, z1)) for x, y in plan], material, UP)

    def lathe(self, base, axis, rings, material, sides=12, caps=(True, True)):
        """A round thing turned about `axis` from `base`: rings [(distance along, radius), ...], smooth sided, as a
        chimney pot, a pipe or a bell is."""
        axis = Vector(axis).normalized()
        side = axis.orthogonal().normalized()
        other = axis.cross(side)
        base = Vector(base)

        def ring(along, radius):
            return [base + axis * along + (side * math.cos(t) + other * math.sin(t)) * radius
                    for t in (2 * math.pi * i / sides for i in range(sides))]

        loops = [ring(*r) for r in rings]
        for (a_along, _), lo, hi in zip(rings, loops, loops[1:]):
            for i in range(sides):
                j = (i + 1) % sides
                quad = [lo[i], lo[j], hi[j], hi[i]]
                centre = base + axis * a_along
                self.face(quad, material, (quad[0] + quad[1]) / 2 - centre, smooth=True)
        if caps[0]:
            self.face(loops[0], material, -axis)
        if caps[1]:
            self.face(loops[-1], material, axis)

    def pipe(self, points, radius, material, sides=8):
        """A round pipe through `points`, each straight run its own length, as a downpipe and its offsets are."""
        for a, b in zip(points, points[1:]):
            a, b = Vector(a), Vector(b)
            self.lathe(a, b - a, [(0, radius), ((b - a).length, radius)], material, sides)

    def build(self, name, materials, tiles):
        """The faces as a Blender object, its first texture coordinates `uv` laid in metres over `tiles[material]`."""
        names = list(dict.fromkeys(m for _, m, _ in self.faces))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(v) for v in self.verts], [], [f for f, _, _ in self.faces])
        for name_ in names:
            mesh.materials.append(materials[name_])
        index = {n: i for i, n in enumerate(names)}
        mesh.polygons.foreach_set('material_index', [index[m] for _, m, _ in self.faces])
        mesh.polygons.foreach_set('use_smooth', [s for _, _, s in self.faces])
        uv = mesh.uv_layers.new(name='uv')
        for poly, (_, material, _) in zip(mesh.polygons, self.faces):
            right, up = flat_axes(poly.normal)
            tile = tiles.get(material, 1.0)
            for loop in poly.loop_indices:
                p = mesh.vertices[mesh.loops[loop].vertex_index].co
                uv.data[loop].uv = (p.dot(right) / tile, p.dot(up) / tile)
        weld(mesh)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    def triangles(self):
        return sum(len(f) - 2 for f, _, _ in self.faces)


def flat_axes(normal):
    """The way along and the way up a face looks to someone in front of it; level faces take x and y."""
    if abs(normal.z) > 0.92:
        return Vector((1, 0, 0)), Vector((0, 1, 0)) * (1 if normal.z > 0 else -1)
    right = UP.cross(normal).normalized()
    return right, normal.cross(right).normalized()


def weld(mesh):
    """Faces that meet share their corners (one island for a wall's cells when it is unwrapped for the bake)."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(mesh)
    bm.free()
