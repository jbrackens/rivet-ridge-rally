"""Build the original RIVET RIDGE RALLY Canyon modular environment kit.

Blender 4.5 LTS, headless-compatible. The script intentionally uses only
Blender-native geometry and solid-color glTF PBR materials so the editable
source is deterministic and has no external file or add-on dependency.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import math
import sys
import uuid
from pathlib import Path

import bpy
from mathutils import Vector


PALETTE = {
    "coral": (0.894, 0.114, 0.063, 1.0),
    "coral_dark": (0.55, 0.055, 0.035, 1.0),
    "cyan": (0.039, 0.74, 0.78, 1.0),
    "cyan_glow": (0.06, 0.9, 1.0, 0.32),
    "teal": (0.025, 0.33, 0.36, 1.0),
    "teal_light": (0.08, 0.49, 0.5, 1.0),
    "cream": (0.89, 0.77, 0.58, 1.0),
    "cream_light": (0.98, 0.9, 0.72, 1.0),
    "navy": (0.018, 0.055, 0.085, 1.0),
    "steel": (0.19, 0.22, 0.23, 1.0),
    "sandstone": (0.55, 0.19, 0.105, 1.0),
    "sandstone_light": (0.72, 0.31, 0.17, 1.0),
    "sandstone_dark": (0.36, 0.105, 0.06, 1.0),
    "dust": (0.30, 0.16, 0.09, 1.0),
    "timber": (0.38, 0.18, 0.075, 1.0),
    "timber_light": (0.59, 0.31, 0.11, 1.0),
    "pine": (0.07, 0.27, 0.15, 1.0),
    "pine_light": (0.13, 0.39, 0.21, 1.0),
    "grass": (0.31, 0.43, 0.055, 1.0),
    "charcoal": (0.012, 0.016, 0.019, 1.0),
    "yellow": (0.97, 0.55, 0.035, 1.0),
}

ROOT_NAMES = (
    "CYN_CoolingGate_A",
    "CYN_WheelieBarrier_A",
    "CYN_TabletopRamp_A",
    "CYN_RockCluster_A",
    "CYN_Pine_A",
    "CYN_DesertPlants_A",
    "CYN_SpectatorStand_A",
    "CYN_FestivalTent_A",
    "CYN_Workshop_A",
    "CYN_MarshalTower_A",
    "CYN_ServiceProps_A",
)

MATERIALS: dict[str, bpy.types.Material] = {}
NAME_COUNTS: dict[str, int] = {}
KIT_COLLECTION: bpy.types.Collection
AUTHORING_SCRIPT_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def sanitize_saved_workspace_metadata() -> None:
    """Remove machine-local UI residue before saving the canonical source."""
    assert bpy.app.version[:3] == (4, 5, 11), "Workspace scrub is pinned to Blender 4.5.11"
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type == "FILE_BROWSER" and space.params is not None:
                    space.params.directory = b"//"
                    space.params.filename = ""
                shading = getattr(space, "shading", None)
                if shading is None:
                    continue
                # Blender 4.5.11 stores three 256-byte studio-light selectors
                # immediately after the View3DShading RNA header. Clear all
                # three fixed buffers so stale image paths cannot survive in
                # the editable deliverable, then restore ordinary defaults.
                ctypes.memset(shading.as_pointer() + 12, 0, 3 * 256)
                shading.type = "SOLID"
                shading.light = "STUDIO"
                shading.studio_light = "Default"


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Build the Canyon modular kit")
    parser.add_argument(
        "--output-dir",
        default="art-source/blender/canyon-kit/generated",
        help="Directory for the canonical .blend and raw .glb",
    )
    return parser.parse_args(values)


def material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    roughness: float = 0.78,
    metallic: float = 0.0,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(f"MAT_{name}")
    mat.diffuse_color = color
    mat.use_nodes = True
    mat.use_backface_culling = False
    node = mat.node_tree.nodes.get("Principled BSDF")
    if node is not None:
        node.inputs["Base Color"].default_value = color
        node.inputs["Roughness"].default_value = roughness
        node.inputs["Metallic"].default_value = metallic
        node.inputs["Alpha"].default_value = color[3]
        emission = node.inputs.get("Emission Color") or node.inputs.get("Emission")
        if emission is not None:
            emission.default_value = color
        strength = node.inputs.get("Emission Strength")
        if strength is not None:
            strength.default_value = emission_strength
    if color[3] < 1.0:
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "DITHERED"
        elif hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
        if hasattr(mat, "use_transparency_overlap"):
            mat.use_transparency_overlap = False
    return mat


def create_materials() -> None:
    MATERIALS.clear()
    for key, color in PALETTE.items():
        roughness = 0.58 if key in {"coral", "cyan", "teal", "teal_light", "navy", "steel"} else 0.86
        metallic = 0.22 if key == "steel" else 0.0
        emission_strength = 4.0 if key == "cyan_glow" else (0.35 if key == "cyan" else 0.0)
        MATERIALS[key] = material(
            key,
            color,
            roughness=roughness,
            metallic=metallic,
            emission_strength=emission_strength,
        )
    MATERIALS["crowd_blue"] = MATERIALS["teal_light"]
    MATERIALS["crowd_orange"] = MATERIALS["coral"]
    MATERIALS["crowd_gold"] = MATERIALS["yellow"]


def stable_name(name: str) -> str:
    count = NAME_COUNTS.get(name, 0) + 1
    NAME_COUNTS[name] = count
    return name if count == 1 else f"{name}_{count:02d}"


def link_to_kit(obj: bpy.types.Object) -> None:
    for collection in tuple(obj.users_collection):
        collection.objects.unlink(obj)
    KIT_COLLECTION.objects.link(obj)


def assign_material(obj: bpy.types.Object, key: str) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(MATERIALS[key])


def parent_to(obj: bpy.types.Object, parent: bpy.types.Object) -> bpy.types.Object:
    obj.parent = parent
    obj.matrix_parent_inverse.identity()
    return obj


def apply_mesh_transform(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)


def bevel(obj: bpy.types.Object, width: float, segments: int = 2) -> None:
    if width <= 0:
        return
    modifier = obj.modifiers.new(name="Authored edge softness", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    except RuntimeError:
        obj.modifiers.remove(modifier)
    obj.select_set(False)


def finish_mesh(obj: bpy.types.Object, key: str, bevel_width: float = 0.0) -> bpy.types.Object:
    link_to_kit(obj)
    apply_mesh_transform(obj)
    assign_material(obj, key)
    bevel(obj, bevel_width)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def root(name: str) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "CUBE"
    obj.empty_display_size = 0.5
    obj["asset_root"] = True
    obj["units"] = "meters"
    obj["forward_axis"] = "+Y"
    obj["up_axis"] = "+Z"
    link_to_kit(obj)
    return obj


def box(
    name: str,
    size: tuple[float, float, float],
    location: tuple[float, float, float],
    key: str,
    parent: bpy.types.Object,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel_width: float = 0.04,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = stable_name(name)
    obj.dimensions = size
    finish_mesh(obj, key, bevel_width)
    return parent_to(obj, parent)


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location: tuple[float, float, float],
    key: str,
    parent: bpy.types.Object,
    *,
    vertices: int = 10,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel_width: float = 0.025,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = stable_name(name)
    finish_mesh(obj, key, bevel_width)
    return parent_to(obj, parent)


def cone(
    name: str,
    radius1: float,
    radius2: float,
    depth: float,
    location: tuple[float, float, float],
    key: str,
    parent: bpy.types.Object,
    *,
    vertices: int = 8,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
    bevel_width: float = 0.02,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = stable_name(name)
    obj.scale = scale
    finish_mesh(obj, key, bevel_width)
    return parent_to(obj, parent)


def ico(
    name: str,
    size: tuple[float, float, float],
    location: tuple[float, float, float],
    key: str,
    parent: bpy.types.Object,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    subdivisions: int = 1,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = stable_name(name)
    obj.scale = (size[0] * 0.5, size[1] * 0.5, size[2] * 0.5)
    finish_mesh(obj, key)
    return parent_to(obj, parent)


def torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    location: tuple[float, float, float],
    key: str,
    parent: bpy.types.Object,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=14,
        minor_segments=6,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = stable_name(name)
    finish_mesh(obj, key)
    return parent_to(obj, parent)


def mesh_object(
    name: str,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    key: str,
    parent: bpy.types.Object,
    *,
    bevel_width: float = 0.0,
) -> bpy.types.Object:
    object_name = stable_name(name)
    mesh = bpy.data.meshes.new(f"{object_name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(object_name, mesh)
    KIT_COLLECTION.objects.link(obj)
    assign_material(obj, key)
    bevel(obj, bevel_width)
    for polygon in mesh.polygons:
        polygon.use_smooth = False
    return parent_to(obj, parent)


def beam_between(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    thickness: float,
    key: str,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    a = Vector(start)
    b = Vector(end)
    delta = b - a
    midpoint = (a + b) * 0.5
    obj = box(
        name,
        (thickness, delta.length, thickness),
        tuple(midpoint),
        key,
        parent,
        bevel_width=thickness * 0.12,
    )
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 1.0, 0.0)).rotation_difference(delta.normalized())
    apply_mesh_transform(obj)
    obj.rotation_mode = "XYZ"
    return obj


def profile_prism(
    name: str,
    width: float,
    profile: list[tuple[float, float]],
    key: str,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    for x in (-width * 0.5, width * 0.5):
        vertices.extend((x, y, z) for y, z in profile)
        vertices.extend((x, y, 0.0) for y, _ in reversed(profile))
    side_count = len(profile) * 2
    faces: list[tuple[int, ...]] = []
    faces.append(tuple(range(side_count)))
    faces.append(tuple(range(side_count, side_count * 2)))
    for index in range(side_count):
        next_index = (index + 1) % side_count
        faces.append((index, next_index, side_count + next_index, side_count + index))
    return mesh_object(name, vertices, faces, key, parent, bevel_width=0.035)


def add_cooling_gate() -> bpy.types.Object:
    asset = root("CYN_CoolingGate_A")
    for side, x in (("L", -3.0), ("R", 3.0)):
        box(f"Gate_{side}_Foot", (1.35, 1.45, 0.28), (x, 0.0, 0.14), "navy", asset, bevel_width=0.09)
        box(f"Gate_{side}_Plinth", (1.02, 1.05, 0.68), (x, 0.0, 0.56), "teal", asset, bevel_width=0.09)
        box(f"Gate_{side}_Post", (0.72, 0.82, 3.75), (x, 0.0, 2.73), "cyan", asset, bevel_width=0.1)
        for tier in range(3):
            box(
                f"Gate_{side}_BaseTrim_{tier}",
                (1.16 - tier * 0.12, 1.18 - tier * 0.1, 0.18),
                (x, -0.02, 0.82 + tier * 0.32),
                "cyan" if tier == 1 else "teal_light",
                asset,
                bevel_width=0.045,
            )
        shoulder_x = x * 0.86
        shoulder_rotation = -0.57 if x < 0 else 0.57
        box(
            f"Gate_{side}_Shoulder",
            (0.75, 0.82, 1.75),
            (shoulder_x, 0.0, 4.88),
            "cyan",
            asset,
            rotation=(0.0, shoulder_rotation, 0.0),
            bevel_width=0.1,
        )
        for z in (1.65, 2.55, 3.45):
            box(f"Gate_{side}_Glow_{z}", (0.78, 0.1, 0.16), (x, -0.46, z), "cyan_glow", asset, bevel_width=0.025)
        cylinder(f"Gate_{side}_Beacon", 0.16, 0.12, (x, -0.49, 4.03), "cream_light", asset, vertices=10, rotation=(math.pi / 2, 0.0, 0.0))
    box("Gate_Header", (4.4, 0.82, 0.72), (0.0, 0.0, 5.55), "cyan", asset, bevel_width=0.1)
    box("Gate_HeaderCore", (3.55, 0.12, 0.22), (0.0, -0.46, 5.55), "cyan_glow", asset, bevel_width=0.04)
    box("Gate_CoolingField", (5.05, 0.055, 4.25), (0.0, 0.03, 2.78), "cyan_glow", asset, bevel_width=0.02)
    asset["presentation_only"] = True
    asset["clear_width_m"] = 5.05
    return asset


def add_wheelie_barrier() -> bpy.types.Object:
    asset = root("CYN_WheelieBarrier_A")
    box("Barrier_Base", (3.8, 0.82, 0.18), (0.0, 0.0, 0.09), "navy", asset, bevel_width=0.055)
    panel_keys = ("cream_light", "coral", "cream_light")
    for index, key in enumerate(panel_keys):
        x = (index - 1) * 1.2
        box(f"Barrier_Panel_{index + 1}", (1.15, 0.68, 0.86), (x, 0.0, 0.58), key, asset, bevel_width=0.09)
        box(f"Barrier_DirtBand_{index + 1}", (1.12, 0.72, 0.14), (x, 0.0, 0.25), "dust", asset, bevel_width=0.025)
    for x in (-1.83, 1.83):
        beam_between("Barrier_SideBrace", (x, -0.48, 0.1), (x, 0.0, 0.92), 0.11, "steel", asset)
        cylinder("Barrier_Bolt", 0.065, 0.08, (x, -0.39, 0.55), "steel", asset, vertices=8, rotation=(math.pi / 2, 0.0, 0.0))
    asset["presentation_only"] = True
    asset["visual_clearance_height_m"] = 1.01
    return asset


def add_tabletop_ramp() -> bpy.types.Object:
    asset = root("CYN_TabletopRamp_A")
    profile = [(-4.2, 0.08), (-3.8, 0.16), (-1.1, 1.55), (1.7, 1.55), (4.15, 0.08)]
    profile_prism("Ramp_DirtBody", 5.9, profile, "sandstone", asset)
    angle_up = math.atan2(1.39, 2.7)
    angle_down = -math.atan2(1.47, 2.45)
    for side, x in (("L", -2.91), ("R", 2.91)):
        box(f"Ramp_{side}_TakeoffRail", (0.15, 3.0, 0.18), (x, -2.46, 0.88), "coral", asset, rotation=(angle_up, 0.0, 0.0), bevel_width=0.035)
        box(f"Ramp_{side}_DeckRail", (0.15, 2.82, 0.18), (x, 0.3, 1.61), "cream_light", asset, bevel_width=0.035)
        box(f"Ramp_{side}_LandingRail", (0.15, 2.7, 0.18), (x, 2.93, 0.82), "teal_light", asset, rotation=(angle_down, 0.0, 0.0), bevel_width=0.035)
    for y in (-3.55, -2.8, -2.05, -1.3, -0.45, 0.45, 1.35, 2.1, 2.85, 3.6):
        z = 0.15
        if y < -1.1:
            z = 0.16 + ((y + 3.8) / 2.7) * 1.39
        elif y <= 1.7:
            z = 1.56
        else:
            z = 1.55 - ((y - 1.7) / 2.45) * 1.47
        box("Ramp_SurfaceSlat", (5.62, 0.16, 0.07), (0.0, y, max(0.12, z + 0.04)), "timber_light", asset, bevel_width=0.022)
    asset["presentation_only"] = True
    asset["profile_authority"] = "runtime course contact curve"
    return asset


def add_rock_cluster() -> bpy.types.Object:
    asset = root("CYN_RockCluster_A")
    rocks = (
        ("Rock_01", (2.2, 1.8, 2.35), (-0.9, 0.2, 1.05), "sandstone", (0.08, 0.0, 0.2)),
        ("Rock_02", (1.55, 1.35, 1.72), (0.72, 0.15, 0.77), "sandstone_light", (-0.12, 0.18, -0.35)),
        ("Rock_03", (1.3, 1.25, 1.1), (1.42, -0.42, 0.49), "sandstone", (0.05, -0.18, 0.25)),
        ("Rock_04", (1.0, 0.88, 0.82), (-1.75, -0.34, 0.36), "sandstone_dark", (-0.2, 0.1, -0.12)),
        ("Rock_05", (1.25, 1.0, 0.72), (0.0, -0.78, 0.32), "sandstone_light", (0.12, 0.24, 0.42)),
    )
    for name, size, location, key, rotation in rocks:
        ico(name, size, location, key, asset, rotation=rotation, subdivisions=2)
    for index, (x, y, scale) in enumerate(((-2.0, 0.75, 0.28), (-1.15, -1.0, 0.22), (0.8, 0.95, 0.3), (1.9, 0.25, 0.2), (1.45, -1.0, 0.16))):
        ico(f"Rock_Pebble_{index + 1}", (scale * 2.0, scale * 1.5, scale), (x, y, scale * 0.38), "sandstone_dark", asset, rotation=(0.0, index * 0.2, index * 0.48))
    return asset


def add_pine() -> bpy.types.Object:
    asset = root("CYN_Pine_A")
    cylinder("Pine_Trunk", 0.34, 2.55, (0.0, 0.0, 1.27), "timber", asset, vertices=9, bevel_width=0.04)
    for index, (z, radius, depth, key, offset) in enumerate((
        (2.2, 1.65, 1.55, "pine", (-0.12, 0.08)),
        (3.0, 1.45, 1.55, "pine_light", (0.1, -0.08)),
        (3.78, 1.18, 1.5, "pine", (-0.08, -0.02)),
        (4.52, 0.88, 1.45, "pine_light", (0.06, 0.05)),
    )):
        cone(f"Pine_NeedleTier_{index + 1}", radius, 0.12, depth, (offset[0], offset[1], z), key, asset, vertices=9, rotation=(0.0, 0.0, index * 0.31), bevel_width=0.03)
    for index, angle in enumerate((0.15, 2.2, 4.3)):
        start = (math.cos(angle) * 0.13, math.sin(angle) * 0.13, 0.18)
        end = (math.cos(angle) * 0.9, math.sin(angle) * 0.9, 0.08)
        beam_between(f"Pine_Root_{index + 1}", start, end, 0.16, "timber", asset)
    return asset


def add_desert_plants() -> bpy.types.Object:
    asset = root("CYN_DesertPlants_A")
    cylinder("Cactus_Trunk", 0.31, 3.1, (-0.45, 0.0, 1.55), "grass", asset, vertices=9, bevel_width=0.04)
    for side, direction, height in (("L", -1.0, 1.75), ("R", 1.0, 1.42)):
        x = -0.45 + direction * 0.65
        cylinder(f"Cactus_{side}_ArmHorizontal", 0.18, 0.78, ((x - direction * 0.28), 0.0, height), "grass", asset, vertices=8, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.035)
        cylinder(f"Cactus_{side}_ArmVertical", 0.18, 1.08, (x, 0.0, height + 0.45), "grass", asset, vertices=8, bevel_width=0.035)
    for index, angle in enumerate((-0.75, -0.42, -0.12, 0.2, 0.48, 0.72)):
        x = 1.15 + math.sin(index * 1.6) * 0.34
        y = 0.15 + math.cos(index * 1.25) * 0.38
        cone(f"Agave_Leaf_{index + 1}", 0.18, 0.02, 1.35, (x, y, 0.58), "grass" if index % 2 else "pine_light", asset, vertices=5, rotation=(angle, 0.0, index * 1.05), scale=(1.0, 0.55, 1.0), bevel_width=0.01)
    for index, (x, y) in enumerate(((0.4, -0.55), (0.15, 0.6), (-1.35, 0.45), (1.65, -0.45))):
        ico(f"Plant_Rock_{index + 1}", (0.42, 0.34, 0.22), (x, y, 0.09), "sandstone_dark", asset, rotation=(0.0, index * 0.5, 0.25))
    return asset


def add_spectator_stand() -> bpy.types.Object:
    asset = root("CYN_SpectatorStand_A")
    for x in (-2.75, 2.75):
        for y in (-1.35, 1.35):
            cylinder("Stand_Foot", 0.16, 2.6, (x, y, 1.3), "timber", asset, vertices=8, bevel_width=0.03)
    for row, (y, z) in enumerate(((1.0, 0.72), (0.2, 1.24), (-0.6, 1.76))):
        box(f"Stand_Tier_{row + 1}", (5.7, 0.92, 0.22), (0.0, y, z), "timber_light", asset, bevel_width=0.04)
        box(f"Stand_Riser_{row + 1}", (5.7, 0.16, z), (0.0, y + 0.4, z * 0.5), "timber", asset, bevel_width=0.025)
    for x in (-2.8, 2.8):
        beam_between("Stand_CrossBrace", (x, -1.35, 0.12), (x, 1.35, 2.25), 0.13, "timber", asset)
        cylinder("Stand_RailPost", 0.075, 1.25, (x, -0.72, 2.12), "timber_light", asset, vertices=8, bevel_width=0.015)
    box("Stand_FrontRail", (5.9, 0.11, 0.12), (0.0, 1.48, 1.28), "cream", asset, bevel_width=0.025)
    box("Stand_BackRail", (5.9, 0.11, 0.12), (0.0, -1.02, 2.48), "cream", asset, bevel_width=0.025)
    for x in (-2.75, 2.75):
        cylinder("Stand_CanopyPost", 0.09, 2.1, (x, -0.9, 3.0), "steel", asset, vertices=8)
    box("Stand_Canopy", (6.15, 2.8, 0.18), (0.0, 0.05, 4.03), "cream_light", asset, rotation=(0.06, 0.0, 0.0), bevel_width=0.06)
    shirt_keys = ("crowd_orange", "crowd_blue", "crowd_gold", "teal_light", "coral")
    spectator_index = 0
    for row, (y, z) in enumerate(((1.0, 1.15), (0.2, 1.67), (-0.6, 2.19))):
        for column in range(5):
            spectator_index += 1
            x = -2.0 + column * 1.0 + (0.16 if row % 2 else 0.0)
            box(f"Spectator_{spectator_index}_Torso", (0.38, 0.3, 0.55), (x, y, z + 0.3), shirt_keys[(row + column) % len(shirt_keys)], asset, bevel_width=0.08)
            ico(f"Spectator_{spectator_index}_Head", (0.3, 0.28, 0.32), (x, y - 0.01, z + 0.73), "cream", asset, subdivisions=1)
    asset["crowd_is_abstract"] = True
    return asset


def add_festival_tent() -> bpy.types.Object:
    asset = root("CYN_FestivalTent_A")
    for x in (-2.1, 2.1):
        for y in (-1.55, 1.55):
            cylinder("Tent_Pole", 0.075, 3.1, (x, y, 1.55), "timber", asset, vertices=8, bevel_width=0.015)
            cylinder("Tent_Foot", 0.16, 0.1, (x, y, 0.05), "steel", asset, vertices=8)
    cone("Tent_Canopy", 3.0, 0.15, 1.55, (0.0, 0.0, 3.25), "cream_light", asset, vertices=4, rotation=(0.0, 0.0, math.pi / 4), scale=(1.0, 0.76, 1.0), bevel_width=0.045)
    cone("Tent_CoralCap", 1.65, 0.08, 0.82, (0.0, 0.0, 3.72), "coral", asset, vertices=4, rotation=(0.0, 0.0, math.pi / 4), scale=(1.0, 0.76, 1.0), bevel_width=0.035)
    box("Tent_Counter", (4.1, 0.62, 0.92), (0.0, 1.2, 0.46), "timber_light", asset, bevel_width=0.055)
    box("Tent_CounterTop", (4.35, 0.76, 0.13), (0.0, 1.18, 0.98), "cream", asset, bevel_width=0.035)
    for index, x in enumerate((-1.5, 1.45)):
        box(f"Tent_SupplyCrate_{index + 1}", (0.82, 0.74, 0.66), (x, -1.0, 0.33), "yellow" if index == 0 else "teal_light", asset, bevel_width=0.04)
        for z in (0.12, 0.54):
            box("Tent_CrateBand", (0.9, 0.78, 0.07), (x, -1.0, z), "timber", asset, bevel_width=0.015)
    for side, x in (("L", -2.45), ("R", 2.45)):
        beam_between(f"Tent_{side}_Guy", (x * 0.84, 1.48, 2.95), (x, 2.15, 0.08), 0.025, "cream", asset)
    return asset


def add_workshop() -> bpy.types.Object:
    asset = root("CYN_Workshop_A")
    box("Workshop_BackWall", (5.2, 0.22, 3.25), (0.0, 1.75, 1.63), "navy", asset, bevel_width=0.06)
    for side, x in (("L", -2.5), ("R", 2.5)):
        box(f"Workshop_{side}_Wall", (0.24, 3.6, 3.25), (x, 0.0, 1.63), "teal", asset, bevel_width=0.06)
        box(f"Workshop_{side}_Corner", (0.34, 0.34, 3.45), (x, -1.72, 1.73), "coral", asset, bevel_width=0.045)
    box("Workshop_Roof", (5.55, 4.05, 0.24), (0.0, 0.0, 3.42), "crowd_blue", asset, rotation=(0.0, -0.025, 0.0), bevel_width=0.075)
    box("Workshop_Awning", (3.7, 1.2, 0.16), (0.0, -2.12, 2.85), "coral", asset, rotation=(0.18, 0.0, 0.0), bevel_width=0.055)
    box("Workshop_Header", (4.45, 0.18, 0.54), (0.0, -1.83, 3.02), "navy", asset, bevel_width=0.04)
    box("Workshop_Bench", (3.65, 0.72, 0.12), (0.0, 1.28, 1.0), "timber_light", asset, bevel_width=0.03)
    for x in (-1.65, 1.65):
        box("Workshop_BenchLeg", (0.18, 0.55, 0.94), (x, 1.28, 0.48), "timber", asset, bevel_width=0.025)
    for index, (x, key) in enumerate(((-1.35, "teal_light"), (1.35, "coral"))):
        box(f"Workshop_Cabinet_{index + 1}", (0.92, 0.52, 0.88), (x, 1.38, 0.45), key, asset, bevel_width=0.06)
        cylinder("Workshop_Handle", 0.04, 0.25, (x, 1.08, 0.52), "steel", asset, vertices=8, rotation=(math.pi / 2, 0.0, 0.0))
    box("Workshop_Window", (1.15, 0.08, 0.72), (1.65, 1.62, 2.15), "cyan_glow", asset, bevel_width=0.04)
    cylinder("Workshop_RoofTank", 0.42, 1.35, (-1.45, 0.45, 4.16), "yellow", asset, vertices=12, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.045)
    box("Workshop_RoofVent", (0.72, 0.72, 0.46), (1.35, 0.45, 3.78), "steel", asset, bevel_width=0.05)
    return asset


def add_marshal_tower() -> bpy.types.Object:
    asset = root("CYN_MarshalTower_A")
    for x in (-1.3, 1.3):
        for y in (-1.2, 1.2):
            cylinder("Tower_Post", 0.14, 3.65, (x, y, 1.83), "timber", asset, vertices=8, bevel_width=0.025)
    box("Tower_Platform", (3.2, 2.95, 0.24), (0.0, 0.0, 3.18), "timber_light", asset, bevel_width=0.045)
    for x in (-1.3, 1.3):
        for y in (-1.2, 1.2):
            cylinder("Tower_RailPost", 0.065, 1.1, (x, y, 3.8), "timber_light", asset, vertices=8, bevel_width=0.012)
    for y in (-1.2, 1.2):
        box("Tower_Rail", (2.75, 0.1, 0.1), (0.0, y, 4.24), "cream", asset, bevel_width=0.02)
    for x in (-1.3, 1.3):
        box("Tower_Rail", (0.1, 2.5, 0.1), (x, 0.0, 4.24), "cream", asset, bevel_width=0.02)
    beam_between("Tower_Brace_FL", (-1.3, -1.2, 0.15), (-1.3, 1.2, 2.9), 0.12, "timber_light", asset)
    beam_between("Tower_Brace_FR", (1.3, -1.2, 0.15), (1.3, 1.2, 2.9), 0.12, "timber_light", asset)
    beam_between("Tower_Brace_Back", (-1.3, 1.2, 0.15), (1.3, 1.2, 2.9), 0.12, "timber_light", asset)
    for index in range(6):
        y = -2.05 + index * 0.34
        z = 0.22 + index * 0.48
        box(f"Tower_Stair_{index + 1}", (1.05, 0.48, 0.13), (0.0, y, z), "timber_light", asset, bevel_width=0.025)
    beam_between("Tower_StairStringer_L", (-0.55, -2.25, 0.08), (-0.55, -0.25, 2.82), 0.1, "timber", asset)
    beam_between("Tower_StairStringer_R", (0.55, -2.25, 0.08), (0.55, -0.25, 2.82), 0.1, "timber", asset)
    for x in (-1.45, 1.45):
        cylinder("Tower_CanopyPost", 0.075, 1.45, (x, 0.0, 4.54), "steel", asset, vertices=8)
    box("Tower_Canopy", (3.45, 2.8, 0.18), (0.0, 0.0, 5.25), "cream_light", asset, rotation=(0.04, 0.0, 0.0), bevel_width=0.055)
    cylinder("Tower_SignalMast", 0.055, 1.2, (1.45, 0.0, 5.8), "steel", asset, vertices=8)
    box("Tower_SignalFlag", (0.06, 0.85, 0.56), (1.45, -0.43, 6.02), "coral", asset, bevel_width=0.02)
    return asset


def add_service_props() -> bpy.types.Object:
    asset = root("CYN_ServiceProps_A")
    for stack, (x, y, count) in enumerate(((-1.5, 0.25, 3), (-0.45, 0.45, 2))):
        for level in range(count):
            torus(f"Service_Tire_{stack + 1}_{level + 1}", 0.42, 0.15, (x, y, 0.16 + level * 0.29), "charcoal", asset)
            for tread in range(8):
                angle = tread * math.tau / 8
                box(
                    "Service_TireTread",
                    (0.2, 0.08, 0.11),
                    (x + math.cos(angle) * 0.53, y + math.sin(angle) * 0.53, 0.16 + level * 0.29),
                    "charcoal",
                    asset,
                    rotation=(0.0, 0.0, angle),
                    bevel_width=0.015,
                )
    for crate_index, (x, y, size) in enumerate(((0.85, 0.1, 1.15), (2.05, 0.45, 0.86))):
        box(f"Service_Crate_{crate_index + 1}_Body", (size, size, size), (x, y, size * 0.5), "timber", asset, bevel_width=0.035)
        for z in (0.12, size - 0.12):
            box("Service_CrateBand", (size + 0.08, size + 0.08, 0.1), (x, y, z), "timber_light", asset, bevel_width=0.02)
        for x_offset in (-size * 0.42, size * 0.42):
            box("Service_CratePost", (0.1, size + 0.06, size), (x + x_offset, y, size * 0.5), "timber_light", asset, bevel_width=0.02)
        beam_between(
            "Service_CrateBrace",
            (x - size * 0.38, y - size * 0.52, 0.14),
            (x + size * 0.38, y - size * 0.52, size - 0.14),
            0.08,
            "timber_light",
            asset,
        )
    cylinder("Service_FuelDrum", 0.42, 1.18, (0.3, -1.05, 0.59), "yellow", asset, vertices=14, bevel_width=0.045)
    for z in (0.14, 1.04):
        torus("Service_DrumBand", 0.38, 0.045, (0.3, -1.05, z), "steel", asset)
    box("Service_ToolCase", (0.82, 0.42, 0.28), (1.45, -0.9, 0.14), "teal_light", asset, bevel_width=0.055)
    box("Service_ToolCaseHandle", (0.32, 0.1, 0.16), (1.45, -0.9, 0.37), "steel", asset, bevel_width=0.025)
    return asset


def build_scene() -> list[bpy.types.Object]:
    global KIT_COLLECTION
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "RIVET RIDGE RALLY — Canyon Modular Kit"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["project"] = "RIVET RIDGE RALLY"
    scene["asset_set"] = "Canyon Modular Kit A"
    scene["generator"] = "art-source/blender/canyon-kit/build_canyon_kit.py"
    scene["source_classification"] = "Original project-authored Blender-native geometry"
    scene["authoring_script_sha256"] = AUTHORING_SCRIPT_SHA256
    scene["authoring_blender_version"] = bpy.app.version_string
    scene["source_schema"] = "rrr-canyon-kit-v1"
    scene["source_pair_id"] = str(uuid.uuid4())
    NAME_COUNTS.clear()
    KIT_COLLECTION = bpy.data.collections.new("Canyon Modular Kit — Runtime Roots")
    scene.collection.children.link(KIT_COLLECTION)
    create_materials()
    assets = [
        add_cooling_gate(),
        add_wheelie_barrier(),
        add_tabletop_ramp(),
        add_rock_cluster(),
        add_pine(),
        add_desert_plants(),
        add_spectator_stand(),
        add_festival_tent(),
        add_workshop(),
        add_marshal_tower(),
        add_service_props(),
    ]
    assert tuple(asset.name for asset in assets) == ROOT_NAMES
    return assets


def descendants(obj: bpy.types.Object) -> list[bpy.types.Object]:
    result = [obj]
    for child in obj.children:
        result.extend(descendants(child))
    return result


def save_and_export(output_dir: Path, assets: list[bpy.types.Object]) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    blend_path = (output_dir / "canyon-kit-source.blend").resolve()
    glb_path = (output_dir / "canyon-kit-raw.glb").resolve()
    # The generated directory is a pinned deliverable, so do not leave Blender's
    # rolling `.blend1` backup beside the accepted source file on rebuild.
    bpy.context.preferences.filepaths.save_version = 0
    sanitize_saved_workspace_metadata()
    bpy.ops.wm.save_as_mainfile(
        filepath=str(blend_path),
        check_existing=False,
        compress=False,
    )

    bpy.ops.object.select_all(action="DESELECT")
    selected: list[bpy.types.Object] = []
    for asset in assets:
        selected.extend(descendants(asset))
    for obj in selected:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = assets[0]
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
    )
    return blend_path, glb_path


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser()
    if not output_dir.is_absolute():
        output_dir = Path.cwd() / output_dir
    assets = build_scene()
    blend_path, glb_path = save_and_export(output_dir, assets)
    mesh_count = sum(1 for obj in bpy.data.objects if obj.type == "MESH")
    triangle_count = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        triangle_count += len(obj.data.loop_triangles)
    print(f"Canyon kit roots: {len(assets)}")
    print(f"Canyon kit mesh objects: {mesh_count}")
    print(f"Saved Blender source: {blend_path}")
    print(f"Exported raw GLB: {glb_path}")
    print(f"Triangulated faces: {triangle_count}")


if __name__ == "__main__":
    main()
