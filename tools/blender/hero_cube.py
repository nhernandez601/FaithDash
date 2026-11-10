# Faith Dash hero cube, built from code in Blender (no hand modelling needed).
# A polished gold shell with bevelled edges. The face (angry eyes + jagged grin) and the side runes are CUT INTO the shell,
# and the cuts glow from inside like a lantern, matching the intro film. A crown of flame spikes sits on top.
#
# Run (from the project folder):
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --python tools/blender/hero_cube.py
# Writes: src/assets/models/hero.glb  (the game loads this)  and  tools/blender/hero_preview.png  (a picture to check)
#
# Axes: Blender is Z-up; the glTF export turns Blender -Y into the game's +Z. The game shows +Z (the back, toward the
# chase camera) and +X (the camera side), so the face is carved on Blender -Y and +X. Cube size is 1 (the game scales it).
import bpy, bmesh, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_GLB = os.path.join(ROOT, 'src', 'assets', 'models', 'hero.glb')
OUT_PNG = os.path.join(HERE, 'hero_preview.png')
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)

# ---------------------------------------------------------------- clean scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def mat(name, base, metal=0.0, rough=0.5, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m

GOLD = mat('Gold', (1.0, 0.42, 0.07), metal=1.0, rough=0.28)  # linear values: shows as rich gold
DARK_GOLD = mat('GoldDark', (0.35, 0.09, 0.01), metal=1.0, rough=0.4)
GLOW = mat('CoreGlow', (1.0, 0.45, 0.05), rough=0.4, emit=(1.0, 0.38, 0.03), strength=3.5)
HOT = mat('EyeHot', (1.0, 0.8, 0.3), rough=0.4, emit=(1.0, 0.72, 0.18), strength=5.0)
FLAME = mat('Flame', (1.0, 0.45, 0.05), metal=0.3, rough=0.3, emit=(1.0, 0.3, 0.01), strength=2.5)
GEM = mat('Gem', (1.0, 0.95, 0.75), rough=0.1, emit=(1.0, 0.92, 0.6), strength=8.0)

def link(obj):
    scene.collection.objects.link(obj)
    return obj

def apply_mods(obj):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)

# ---------------------------------------------------------------- the shell
bpy.ops.mesh.primitive_cube_add(size=1.0)
shell = bpy.context.active_object; shell.name = 'HeroShell'
shell.data.materials.append(GOLD)
bev = shell.modifiers.new('Bevel', 'BEVEL'); bev.width = 0.075; bev.segments = 5; bev.limit_method = 'NONE'
apply_mods(shell)

# ---------------------------------------------------------------- cutters (prisms pushed into a face)
def prism(name, pts2d, face, depth=0.09, material=GLOW):
    """pts2d: outline in face coords (u right, v up), cube spans -0.5..0.5. face: '-Y' or '+X' or '+Y' or '-X'."""
    bm = bmesh.new()
    out = 0.05  # start a little outside the surface so the cut is clean
    top = [bm.verts.new((u, v, out)) for u, v in pts2d]
    bot = [bm.verts.new((u, v, -depth)) for u, v in pts2d]
    bm.faces.new(top); bm.faces.new(list(reversed(bot)))
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], top[j], bot[j], bot[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = link(bpy.data.objects.new(name, me))
    ob.data.materials.append(material)
    # local z (out of the face) -> face normal; local u -> face's right as seen from outside
    if face == '-Y':   ob.rotation_euler = (math.radians(90), 0, 0); ob.location = (0, -0.5, 0)
    elif face == '+X': ob.rotation_euler = (math.radians(90), 0, math.radians(90)); ob.location = (0.5, 0, 0)
    elif face == '+Y': ob.rotation_euler = (math.radians(90), 0, math.radians(180)); ob.location = (0, 0.5, 0)
    elif face == '-X': ob.rotation_euler = (math.radians(90), 0, math.radians(-90)); ob.location = (-0.5, 0, 0)
    return ob

def cut(target, cutter):
    m = target.modifiers.new('Cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = cutter; m.solver = 'EXACT'
    try: m.material_mode = 'TRANSFER'
    except Exception: pass
    apply_mods(target)
    bpy.data.objects.remove(cutter, do_unlink=True)

def mirror_u(pts): return [(-u, v) for u, v in reversed(pts)]

# angry eyes: slanted triangles, wider at the outside, like the film
eye_L = [(-0.06, 0.10), (-0.34, 0.21), (-0.26, -0.02)]
# jagged grin: zig-zag teeth on top, smooth curve underneath
grin = []
N = 9
for i in range(N + 1):
    t = i / N; u = -0.27 + t * 0.54
    v = -0.10 - math.sin(t * math.pi) * 0.07 + (0.035 if i % 2 else -0.02)
    grin.append((u, v))
for i in range(N, -1, -1):
    t = i / N; u = -0.27 + t * 0.54
    grin.append((u, -0.13 - math.sin(t * math.pi) * 0.19))

# diamond rune (sides): an outer diamond ring = big diamond minus small diamond, done as two cuts
def diamond(r, cx=0.0, cy=0.0, k=1.35): return [(cx, cy + r * k), (cx + r, cy), (cx, cy - r * k), (cx - r, cy)]

for face in ('-Y', '+X'):
    cut(shell, prism('eyeL', eye_L, face, 0.1, HOT))
    cut(shell, prism('eyeR', mirror_u(eye_L), face, 0.1, HOT))
    cut(shell, prism('grin', grin, face, 0.08, GLOW))
for face in ('+Y', '-X'):
    cut(shell, prism('rune', diamond(0.2), face, 0.07, GLOW))

# shallow panel groove around every face (a raised frame look)
for face in ('-Y', '+X', '+Y', '-X'):
    o, i = 0.40, 0.375
    ring_out = [(-o, -o), (o, -o), (o, o), (-o, o)]
    # four thin bars make a square groove
    for bar in ([(-o, o - 0.025), (o, o - 0.025), (o, o), (-o, o)], [(-o, -o), (o, -o), (o, -o + 0.025), (-o, -o + 0.025)],
                [(-o, -o), (-o + 0.025, -o), (-o + 0.025, o), (-o, o)], [(o - 0.025, -o), (o, -o), (o, o), (o - 0.025, o)]):
        cut(shell, prism('groove', bar, face, 0.02, DARK_GOLD))

# the floating gem inside the side runes (a small glowing diamond set into the cut)
def add(obj, m):
    obj.data.materials.append(m); return obj

for loc, rot in (((0, 0.455, 0), (math.radians(-90), 0, 0)), ((-0.455, 0, 0), (0, math.radians(-90), 0))):
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.1, depth=0.08, location=loc, rotation=rot)
    add(bpy.context.active_object, GEM)

# corner studs on the two face sides
for face in ('-Y', '+X'):
    for su in (-1, 1):
        for sv in (-1, 1):
            u, v = su * 0.36, sv * 0.36
            loc = (u, -0.5, v) if face == '-Y' else (0.5, u, v)
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.028, segments=12, ring_count=8, location=loc)
            add(bpy.context.active_object, GOLD)

# ---------------------------------------------------------------- crown of flame spikes on top
for i in range(7):
    a = i / 7 * math.tau
    h = 0.20 + (i % 3) * 0.07
    bpy.ops.mesh.primitive_cone_add(vertices=5, radius1=0.05, radius2=0.0, depth=h, location=(math.cos(a) * 0.26, math.sin(a) * 0.26, 0.5 + h / 2 - 0.02))
    c = bpy.context.active_object; add(c, FLAME)
    c.rotation_euler = (-math.sin(a) * 0.45, math.cos(a) * 0.45, 0)
bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.07, depth=0.24, location=(0, 0, 0.62))
add(bpy.context.active_object, GEM)

# ---------------------------------------------------------------- join everything into one object, smooth shading
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = shell
bpy.ops.object.join()
hero = bpy.context.active_object; hero.name = 'Hero'
bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
apply_mods(hero)

# ---------------------------------------------------------------- export for the game
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
print('WROTE', OUT_GLB)

# ---------------------------------------------------------------- preview render (so we can look at it)
world = bpy.data.worlds.new('W'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.03, 0.025, 0.08, 1)
cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); link(cam)
cam.location = (2.1, -2.4, 1.35)
cam.rotation_euler = (Vector((0, 0, 0.05)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 50; scene.camera = cam
for loc, energy, col in (((-2, -2, 3), 600, (1, 0.9, 0.8)), ((3, 1, 1), 300, (0.5, 0.8, 1.0)), ((0, 3, 2), 250, (1, 0.6, 0.3))):
    l = bpy.data.objects.new('L', bpy.data.lights.new('L', 'AREA')); l.data.energy = energy; l.data.color = col; l.data.size = 2; l.location = loc
    l.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler(); link(l)
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.device = 'CPU'
scene.render.resolution_x = 900; scene.render.resolution_y = 900
scene.render.filepath = OUT_PNG
scene.view_settings.view_transform = 'AgX'
bpy.ops.render.render(write_still=True)
print('WROTE', OUT_PNG)
