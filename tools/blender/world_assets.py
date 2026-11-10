# Faith Dash world assets, built from code in Blender: crystal spikes, gear saw, portal, cross coin, cyber platform,
# lane barrier, roll-under gate, three floating islands and a road segment. Each is exported as its own .glb for the game,
# then all of them are laid out and rendered as a 4K showcase sheet.
#
# Run (from the project folder; the 4K render takes a few minutes):
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --python tools/blender/world_assets.py
#   add  -- --no-render   at the end to only export the models
# Writes: src/assets/models/<name>.glb  and  tools/blender/assets_4k.png
#
# Units are game units (1 = one tile; the road is 3.6 wide, the cube 0.8). Blender is Z-up; the glTF export turns
# Blender -Y into the game's +Z (toward the chase camera), so "front" faces are modelled facing Blender -Y.
# Colours are LINEAR values (they look lighter on screen).
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'src', 'assets', 'models')
SHEET = os.path.join(HERE, 'assets_4k.png')
os.makedirs(OUT, exist_ok=True)
NO_RENDER = '--no-render' in sys.argv
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TAU = math.tau

# ---------------------------------------------------------------- materials
def mat(name, base, metal=0.0, rough=0.5, emit=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    return m

M = {
    'gold': mat('Gold', (1.0, 0.56, 0.13), metal=1.0, rough=0.22),
    'goldDark': mat('GoldDark', (0.35, 0.10, 0.015), metal=1.0, rough=0.4),
    'steel': mat('Steel', (0.55, 0.57, 0.62), metal=1.0, rough=0.3),
    'darkSteel': mat('DarkSteel', (0.06, 0.065, 0.085), metal=0.9, rough=0.35),
    'stone': mat('Stone', (0.09, 0.085, 0.12), rough=0.85),
    'stoneLight': mat('StoneLight', (0.22, 0.2, 0.27), rough=0.8),
    'slate': mat('Slate', (0.025, 0.03, 0.05), metal=0.5, rough=0.4),
    'grass': mat('Grass', (0.12, 0.35, 0.05), rough=0.9),
    'grassLight': mat('GrassLight', (0.25, 0.5, 0.08), rough=0.9),
    'rock': mat('Rock', (0.1, 0.075, 0.09), rough=0.95),
    'bark': mat('Bark', (0.09, 0.04, 0.02), rough=0.9),
    'leaf': mat('Leaf', (0.05, 0.22, 0.06), rough=0.8),
    'crystal': mat('Crystal', (0.45, 0.2, 1.0), rough=0.05, emit=(0.55, 0.22, 1.0), strength=2.5),
    'crystalCyan': mat('CrystalCyan', (0.2, 0.75, 1.0), rough=0.05, emit=(0.15, 0.7, 1.0), strength=2.5),
    'neon': mat('Neon', (0.2, 0.85, 1.0), emit=(0.25, 0.9, 1.0), strength=6.0),
    'neonPurple': mat('NeonPurple', (0.6, 0.3, 1.0), emit=(0.6, 0.25, 1.0), strength=6.0),
    'hot': mat('Hot', (1.0, 0.35, 0.03), emit=(1.0, 0.3, 0.02), strength=6.0),
    'laser': mat('Laser', (1.0, 0.08, 0.05), emit=(1.0, 0.06, 0.04), strength=10.0),
    'field': mat('Field', (1.0, 0.1, 0.08), emit=(1.0, 0.08, 0.05), strength=1.5, alpha=0.35),
    'warn': mat('WarnYellow', (1.0, 0.55, 0.02), rough=0.5),
    'water': mat('Water', (0.3, 0.8, 1.0), emit=(0.3, 0.8, 1.0), strength=2.0),
}

def link(ob, coll):
    coll.objects.link(ob); return ob

def new_coll(name):
    c = bpy.data.collections.new(name); scene.collection.children.link(c); return c

def active():
    return bpy.context.active_object

def to_coll(ob, coll):
    for c in list(ob.users_collection): c.objects.unlink(ob)
    coll.objects.link(ob); return ob

def setmat(ob, m):
    ob.data.materials.clear(); ob.data.materials.append(m); return ob

def apply_all(ob):
    bpy.context.view_layer.objects.active = ob
    for md in list(ob.modifiers):
        try: bpy.ops.object.modifier_apply(modifier=md.name)
        except Exception as e: print('modifier skip', md.name, e)

def bevel(ob, w, seg=3):
    md = ob.modifiers.new('Bevel', 'BEVEL'); md.width = w; md.segments = seg; md.limit_method = 'ANGLE'
    apply_all(ob); return ob

def cube(coll, size, loc, m, bev=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = active(); o.scale = size; bpy.ops.object.transform_apply(scale=True, rotation=False, location=False)
    setmat(o, m); to_coll(o, coll)
    if bev: bevel(o, bev)
    return o

def cyl(coll, r, depth, loc, m, verts=32, rot=(0, 0, 0), r2=None):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else: bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = active(); setmat(o, m); to_coll(o, coll); return o

def torus(coll, R, r, loc, m, rot=(0, 0, 0), maj=48, mn=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=maj, minor_segments=mn, location=loc, rotation=rot)
    o = active(); setmat(o, m); to_coll(o, coll); return o

def sphere(coll, r, loc, m, sub=2, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=loc)
    o = active(); o.scale = scale; bpy.ops.object.transform_apply(scale=True, location=False, rotation=False)
    setmat(o, m); to_coll(o, coll); return o

def crystal_shard(coll, loc, h, r, tilt, m):
    """A six-sided crystal with a pointed tip, standing on loc."""
    bm = bmesh.new()
    n = 6; body = h * 0.7
    bot = [bm.verts.new((math.cos(i / n * TAU) * r, math.sin(i / n * TAU) * r, 0)) for i in range(n)]
    top = [bm.verts.new((math.cos(i / n * TAU) * r * 0.85, math.sin(i / n * TAU) * r * 0.85, body)) for i in range(n)]
    tip = bm.verts.new((0, 0, h))
    bm.faces.new(list(reversed(bot)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i])); bm.faces.new((top[i], top[j], tip))
    me = bpy.data.meshes.new('shard'); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new('shard', me), coll); setmat(o, m)
    o.location = loc; o.rotation_euler = tilt
    uv_project(o)
    return o

def uv_project(o):
    """bmesh-made meshes have no UVs; give them a simple box projection so every asset exports with UVs."""
    me = o.data
    if not me.uv_layers: me.uv_layers.new(name='UVMap')
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        nrm = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if abs(nrm.z) > max(abs(nrm.x), abs(nrm.y)): uv[li].uv = (co.x, co.y)
            elif abs(nrm.x) > abs(nrm.y): uv[li].uv = (co.y, co.z)
            else: uv[li].uv = (co.x, co.z)

def join(coll, name):
    bpy.ops.object.select_all(action='DESELECT')
    obs = [o for o in coll.objects if o.type == 'MESH']
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    o = active(); o.name = name
    bpy.ops.object.shade_auto_smooth(angle=math.radians(32))
    apply_all(o)
    return o

def export(o, name):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    loc = o.location.copy(); o.location = (0, 0, 0)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    o.location = loc
    print('WROTE', name)

def subdiv(o, cuts):
    """Add vertices so the noise below has something to bend (keeps the low-poly look, just more rugged)."""
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.subdivide(number_cuts=cuts)
    bpy.ops.object.mode_set(mode='OBJECT')

def noisy(o, strength, scale=0.6, seed=0):
    tx = bpy.data.textures.new('n%d' % seed, 'CLOUDS'); tx.noise_scale = scale; tx.noise_depth = 2
    md = o.modifiers.new('Disp', 'DISPLACE'); md.texture = tx; md.strength = strength; md.mid_level = 0.5
    apply_all(o)

# ================================================================ 1. crystal spike cluster (one lane of a spike tile)
def build_crystals():
    c = new_coll('crystals')
    base = sphere(c, 0.32, (0, 0, 0.0), M['rock'], sub=2, scale=(1, 1, 0.35)); noisy(base, 0.06, 0.3, 1)
    for i, (dx, dy, h, r, tx, ty, mm) in enumerate([(0, 0, 0.82, 0.11, 0, 0, 'crystal'), (0.13, 0.05, 0.55, 0.08, 0.1, 0.35, 'crystalCyan'),
                                                    (-0.12, -0.04, 0.6, 0.085, -0.05, -0.4, 'crystal'), (0.03, -0.14, 0.42, 0.07, -0.4, 0.1, 'crystalCyan'),
                                                    (-0.05, 0.14, 0.38, 0.06, 0.4, -0.15, 'crystal')]):
        crystal_shard(c, (dx, dy, 0.03), h, r, (tx, ty, random.random()), M[mm])
    return join(c, 'Crystals')

# ================================================================ 2. gear saw (radius 1, spins about the game X axis)
def build_saw():
    c = new_coll('saw')
    bm = bmesh.new(); pts = []
    N = 18
    for i in range(N):
        a0 = i / N * TAU
        for a, rr in ((a0, 0.82), (a0 + 0.22 * TAU / N, 1.0), (a0 + 0.55 * TAU / N, 1.0), (a0 + 0.78 * TAU / N, 0.82)):
            pts.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, 0)))
    f = bm.faces.new(pts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]: v.co.z += 0.16
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('gear'); bm.to_mesh(me); bm.free()
    g = link(bpy.data.objects.new('gear', me), c); setmat(g, M['steel']); g.location.z = -0.08; uv_project(g)
    bevel(g, 0.02, 2)
    for k in range(6):  # lightening holes
        a = k / 6 * TAU
        h = cyl(c, 0.12, 0.5, (math.cos(a) * 0.55, math.sin(a) * 0.55, 0), M['steel'], 24)
        md = g.modifiers.new('hole', 'BOOLEAN'); md.operation = 'DIFFERENCE'; md.object = h; md.solver = 'EXACT'; apply_all(g)
        bpy.data.objects.remove(h, do_unlink=True)
    torus(c, 0.84, 0.035, (0, 0, 0.1), M['hot'], maj=64, mn=8)
    torus(c, 0.84, 0.035, (0, 0, -0.1), M['hot'], maj=64, mn=8)
    cyl(c, 0.26, 0.32, (0, 0, 0), M['darkSteel'], 32)
    cyl(c, 0.14, 0.36, (0, 0, 0), M['hot'], 24)
    for k in range(6):
        a = k / 6 * TAU + 0.5
        cyl(c, 0.03, 0.34, (math.cos(a) * 0.2, math.sin(a) * 0.2, 0), M['steel'], 8)
    o = join(c, 'Saw')
    o.rotation_euler = (0, math.radians(90), 0); bpy.ops.object.transform_apply(rotation=True)  # axle along X
    return o

# ================================================================ 3. portal ring (radius 1.9, faces the camera)
def build_portal():
    c = new_coll('portal')
    R = 1.9
    torus(c, R, 0.2, (0, 0, 0), M['darkSteel'], maj=72, mn=16)
    torus(c, R - 0.2, 0.05, (0, -0.05, 0), M['neonPurple'], maj=72, mn=8)
    torus(c, R + 0.2, 0.035, (0, -0.02, 0), M['gold'], maj=72, mn=8)
    # the torus lies in the XY plane here (the whole portal is turned upright at the end)
    for k in range(8):  # stone clamps with gold caps around the ring
        a = k / 8 * TAU
        cube(c, (0.5, 0.36, 0.52), (math.cos(a) * R, math.sin(a) * R, 0), M['stoneLight'], bev=0.05, rot=(0, 0, a))
        cube(c, (0.52, 0.38, 0.08), (math.cos(a) * R, math.sin(a) * R, 0.27), M['gold'], rot=(0, 0, a))
        cube(c, (0.52, 0.38, 0.08), (math.cos(a) * R, math.sin(a) * R, -0.27), M['gold'], rot=(0, 0, a))
    for k in range(4):  # glowing crystals on the diagonals, pointing outwards from the ring
        a = k / 4 * TAU + TAU / 8
        s = crystal_shard(c, (math.cos(a) * (R + 0.18), math.sin(a) * (R + 0.18), 0), 0.7, 0.11, (0, 0, 0), M['crystal'])
        s.rotation_euler = (0, math.pi / 2, a)  # tip along +X, then turned to point outwards
    o = join(c, 'Portal')
    o.rotation_euler = (math.radians(90), 0, 0); bpy.ops.object.transform_apply(rotation=True)  # ring faces Blender -Y
    return o

# ================================================================ 4. cross coin (radius 0.75, faces the camera)
def build_coin():
    c = new_coll('coin')
    body = cyl(c, 0.75, 0.12, (0, 0, 0), M['gold'], 64); bevel(body, 0.03, 3)
    for z in (0.065, -0.065):
        torus(c, 0.66, 0.035, (0, 0, z), M['gold'], maj=64, mn=10)
        cube(c, (0.14, 0.78, 0.05), (0, 0, z), M['gold'], bev=0.02)
        cube(c, (0.5, 0.14, 0.05), (0, 0.12, z), M['gold'], bev=0.02)
        for k in range(8):
            a = k / 8 * TAU
            sphere(c, 0.035, (math.cos(a) * 0.56, math.sin(a) * 0.56, z), M['gold'], sub=1)
    o = join(c, 'Coin')
    o.rotation_euler = (math.radians(90), 0, 0); bpy.ops.object.transform_apply(rotation=True)
    return o

# ================================================================ 5. cyber platform (3.6 wide, 3.3 long, 0.4 thick, top at z=0.2)
def build_platform():
    c = new_coll('platform')
    cube(c, (3.6, 3.3, 0.4), (0, 0, 0), M['slate'], bev=0.06)
    for i in range(3):  # top panels
        for j in range(3):
            cube(c, (1.08, 0.98, 0.03), (-1.2 + i * 1.2, -1.1 + j * 1.1, 0.2), M['stone'], bev=0.01)
    for sx in (-1, 1):
        cube(c, (0.05, 3.32, 0.05), (sx * 1.8, 0, 0.19), M['neonPurple'])
        cube(c, (0.05, 3.32, 0.04), (sx * 1.8, 0, -0.14), M['neon'])
    for sy in (-1, 1): cube(c, (3.62, 0.05, 0.05), (0, sy * 1.65, 0.19), M['neonPurple'])
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(c, 0.22, 0.12, (sx * 1.3, sy * 1.15, -0.25), M['darkSteel'], 24)
            cyl(c, 0.14, 0.04, (sx * 1.3, sy * 1.15, -0.32), M['neon'], 24)
    return join(c, 'Platform')

# ================================================================ 6. lane barrier (one lane: 1.1 wide, 0.9 deep, 2.7 tall, base at z=0)
def build_barrier():
    c = new_coll('barrier')
    cube(c, (1.1, 0.9, 2.5), (0, 0, 1.25), M['stone'], bev=0.06)
    for z in (0.35, 2.15): cube(c, (1.14, 0.94, 0.12), (0, 0, z), M['gold'], bev=0.02)
    for sy in (-1, 1):  # glowing rune diamond, front and back
        o = cube(c, (0.38, 0.06, 0.38), (0, sy * 0.46, 1.25), M['hot'], rot=(0, math.radians(45), 0))
        cube(c, (0.52, 0.04, 0.52), (0, sy * 0.455, 1.25), M['goldDark'], rot=(0, math.radians(45), 0))
        for k in range(5):  # warning chevrons
            cube(c, (0.18, 0.03, 0.06), (-0.4 + k * 0.2, sy * 0.465, 0.62), M['warn'], rot=(0, math.radians(35), 0))
    for k, (dx, dy, h) in enumerate([(0, 0, 0.55), (0.25, 0.1, 0.35), (-0.25, -0.1, 0.4), (0.1, -0.2, 0.3)]):
        crystal_shard(c, (dx, dy, 2.5), h, 0.09, (random.uniform(-0.3, 0.3), random.uniform(-0.3, 0.3), 0), M['crystal'])
    return join(c, 'Barrier')

# ================================================================ 7. roll-under gate (spans the 3.6 road; beam bottom at 0.55, energy wall above)
def build_gate():
    c = new_coll('gate')
    W = 3.6 / 2 + 0.18
    for sx in (-1, 1):
        cube(c, (0.3, 0.4, 2.9), (sx * W, 0, 1.45), M['darkSteel'], bev=0.04)
        for k in range(6):
            cube(c, (0.31, 0.41, 0.12), (sx * W, 0, 0.3 + k * 0.42), M['warn'] if k % 2 == 0 else M['darkSteel'])
        cyl(c, 0.12, 0.42, (sx * W, 0, 0.67), M['hot'], 20, rot=(math.radians(90), 0, 0))
    cyl(c, 0.12, 2 * W, (0, 0, 0.67), M['laser'], 24, rot=(0, math.radians(90), 0))          # the beam you roll under
    cube(c, (2 * W + 0.3, 0.4, 0.22), (0, 0, 2.9), M['darkSteel'], bev=0.03)                   # top bar
    cube(c, (2 * W - 0.3, 0.03, 0.04), (0, -0.2, 2.82), M['laser'])
    cube(c, (2 * W - 0.3, 0.02, 2.0), (0, 0, 1.8), M['field'])                                  # red energy wall above the beam
    for k in range(3):  # "roll" chevrons pointing down, on the field
        for side in (-1, 1):
            cube(c, (0.32, 0.03, 0.06), (-0.9 + k * 0.9 + side * 0.11, -0.03, 1.55 + abs(side) * 0.0 - side * 0.0), M['warn'], rot=(0, math.radians(35 * side), 0))
    return join(c, 'Gate')

# ================================================================ 8-10. floating islands (about 2 wide, grass top at z=0)
def tree_pine(c, x, y, z, s):
    cyl(c, 0.05 * s, 0.35 * s, (x, y, z + 0.17 * s), M['bark'], 8)
    for k in range(3): cyl(c, (0.32 - k * 0.08) * s, 0.4 * s, (x, y, z + (0.45 + k * 0.25) * s), M['leaf'], 8, r2=0.0)

def tree_round(c, x, y, z, s):
    cyl(c, 0.05 * s, 0.4 * s, (x, y, z + 0.2 * s), M['bark'], 8)
    o = sphere(c, 0.3 * s, (x, y, z + 0.55 * s), M['grassLight'], sub=1); noisy(o, 0.08 * s, 0.2, int(x * 100) % 97)

def build_island(kind):
    c = new_coll('island%d' % kind)
    top = cyl(c, 1.0, 0.22, (0, 0, -0.11), M['grass'], 16); subdiv(top, 2); noisy(top, 0.07, 0.35, kind * 3)
    rim = cyl(c, 1.0, 0.35, (0, 0, -0.38), M['rock'], 16, r2=0.92); subdiv(rim, 2); noisy(rim, 0.1, 0.25, kind * 5)
    under = cyl(c, 0.92, 2.2 + kind * 0.3, (0, 0, -1.55 - kind * 0.15), M['rock'], 14, r2=0.08); subdiv(under, 3); noisy(under, 0.45, 0.35, kind * 7)
    for k in range(3):  # rock spikes hanging under the island
        a = k / 3 * TAU + kind
        sp = cyl(c, 0.22, 1.2 + random.random() * 0.8, (math.cos(a) * 0.45, math.sin(a) * 0.45, -1.2 - random.random() * 0.5), M['rock'], 7, r2=0.0, rot=(math.pi, 0, 0))
        subdiv(sp, 1); noisy(sp, 0.08, 0.2, k + 11 * kind)
    for k in range(5):  # boulders hanging under
        a = random.random() * TAU
        o = sphere(c, 0.18 + random.random() * 0.12, (math.cos(a) * 0.5, math.sin(a) * 0.5, -0.9 - random.random() * 0.8), M['rock'], sub=1); noisy(o, 0.05, 0.2, k + kind)
    for k in range(4):  # rocks on top
        a = random.random() * TAU; d = 0.4 + random.random() * 0.45
        sphere(c, 0.08 + random.random() * 0.07, (math.cos(a) * d, math.sin(a) * d, 0.04), M['stoneLight'], sub=1, scale=(1, 1, 0.6))
    if kind == 1:
        tree_pine(c, -0.3, 0.2, 0, 1.0); tree_pine(c, 0.35, -0.25, 0, 0.75); tree_round(c, 0.2, 0.45, 0, 0.8)
    elif kind == 2:
        tree_round(c, -0.2, -0.1, 0, 1.1); tree_round(c, 0.45, 0.3, 0, 0.7)
        for k in range(3):  # little glowing crystals
            a = k / 3 * TAU; crystal_shard(c, (math.cos(a) * 0.65, math.sin(a) * 0.65, 0), 0.35, 0.06, (0.2, 0.1, 0), M['crystalCyan'])
    else:
        for k, a in enumerate((0.3, 1.9, 3.6)):  # ruined gold-trimmed pillars + a waterfall
            h = 0.6 + k * 0.25
            cyl(c, 0.09, h, (math.cos(a) * 0.55, math.sin(a) * 0.55, h / 2), M['stoneLight'], 12)
            cyl(c, 0.12, 0.06, (math.cos(a) * 0.55, math.sin(a) * 0.55, h), M['gold'], 12)
        tree_pine(c, 0.0, 0.1, 0, 0.9)
        cube(c, (0.25, 0.02, 1.6), (0.3, -0.93, -0.8), M['water'])
    return join(c, 'Island%d' % kind)

# ================================================================ 11. road segment (render sheet only; the game draws the road itself)
def build_road():
    c = new_coll('road')
    cube(c, (3.6, 4.0, 0.5), (0, 0, -0.25), M['slate'], bev=0.03)
    for j in range(2): cube(c, (3.5, 1.94, 0.02), (0, -1.0 + j * 2.0, 0.005), M['darkSteel'], bev=0.005)
    for lx in (-0.6, 0.6):
        for j in range(2): cube(c, (0.05, 1.2, 0.012), (lx, -1.0 + j * 2.0, 0.02), M['neon'])
    for sx in (-1, 1):
        cube(c, (0.16, 4.0, 0.14), (sx * 1.82, 0, 0.07), M['darkSteel'], bev=0.02)
        cube(c, (0.06, 4.0, 0.03), (sx * 1.82, 0, 0.155), M['neon'])
        cube(c, (0.03, 4.0, 0.03), (sx * 1.81, 0, -0.25), M['neon'])
    return join(c, 'Road')

# ---------------------------------------------------------------- build + export
assets = []
for name, fn in (('crystals', build_crystals), ('saw', build_saw), ('portal', build_portal), ('coin', build_coin), ('platform', build_platform),
                 ('barrier', build_barrier), ('gate', build_gate), ('island1', lambda: build_island(1)), ('island2', lambda: build_island(2)),
                 ('island3', lambda: build_island(3)), ('road', build_road)):
    o = fn()
    if name != 'road': export(o, name)
    assets.append((name, o))

if NO_RENDER:
    sys.exit(0)

# ---------------------------------------------------------------- 4K showcase sheet
LAYOUT = {  # name: (x, y, z, scale, rotZ)
    'road': (0, 1.2, 0, 1.0, 0), 'gate': (0, 1.2, 0, 1.0, 0),
    'portal': (-6.2, 3, 2.2, 0.9, 0.25), 'platform': (6.2, 2.5, 0.6, 0.85, -0.35),
    'barrier': (3.2, -1.2, 0, 1.0, -0.3), 'saw': (-3.2, -1.4, 1.1, 0.95, 0.35),
    'coin': (-0.2, -2.6, 0.95, 1.1, 0.3), 'crystals': (1.5, -3.2, 0, 1.6, 0),
    'island1': (-8.8, -2, 2.0, 1.25, 0.4), 'island2': (8.8, -1.6, 2.4, 1.15, 0.2), 'island3': (-1.8, 7.5, 4.5, 1.6, 0.6),
}
for name, o in assets:
    x, y, z, s, rz = LAYOUT[name]
    o.location = (x, y, z); o.scale = (s, s, s); o.rotation_euler = (0, 0, rz)
# a dark reflective floor and a gradient sky
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, -0.6)); fl = active(); setmat(fl, mat('Floor', (0.03, 0.025, 0.06), metal=0.5, rough=0.18))
world = bpy.data.worlds.new('W'); scene.world = world; world.use_nodes = True
nt = world.node_tree; bg = nt.nodes['Background']
grad = nt.nodes.new('ShaderNodeTexGradient'); ramp = nt.nodes.new('ShaderNodeValToRGB'); coord = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping')
mp.inputs['Rotation'].default_value = (0, math.radians(-90), 0)
nt.links.new(coord.outputs['Generated'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], grad.inputs['Vector'])
nt.links.new(grad.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
ramp.color_ramp.elements[0].color = (0.05, 0.03, 0.14, 1); ramp.color_ramp.elements[1].color = (0.35, 0.15, 0.6, 1)
bg.inputs['Strength'].default_value = 1.6
cam = link(bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')), scene.collection)
cam.location = (0, -19, 9.5); cam.data.lens = 34
cam.rotation_euler = (Vector((0, 1.0, 0.9)) - cam.location).to_track_quat('-Z', 'Y').to_euler(); scene.camera = cam
for loc, e, col, size in (((-8, -10, 12), 9000, (1, 0.92, 0.85), 8), ((10, -6, 6), 4500, (0.45, 0.75, 1.0), 6), ((0, 12, 8), 6000, (0.8, 0.45, 1.0), 10), ((0, -14, 2), 2500, (1, 0.8, 0.6), 12)):
    l = link(bpy.data.objects.new('L', bpy.data.lights.new('L', 'AREA')), scene.collection); l.data.energy = e; l.data.color = col; l.data.size = size; l.location = loc
    l.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 40; scene.cycles.use_denoising = True
scene.render.resolution_x = 3840; scene.render.resolution_y = 2160; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'; scene.view_settings.look = 'AgX - Punchy'
scene.render.filepath = SHEET
bpy.ops.render.render(write_still=True)
print('WROTE', SHEET)
