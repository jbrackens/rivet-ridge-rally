"""Build the original RIVET RIDGE RALLY hero bike and rider.

Blender 4.5 LTS, headless-compatible. The model uses only Blender-native
geometry and solid-color glTF PBR materials. It exports stable wheel and rider
pose pivots for the existing TypeScript presentation layer while remaining
strictly presentation-only.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import math
import sys
import uuid
from array import array
from pathlib import Path

import bpy
from mathutils import Vector


PALETTE = {
    "teal": (0.004, 0.245, 0.225, 1.0),
    "coral": (0.80, 0.055, 0.022, 1.0),
    "cream": (0.91, 0.84, 0.70, 1.0),
    "navy": (0.018, 0.055, 0.085, 1.0),
    "charcoal": (0.018, 0.022, 0.026, 1.0),
    "rubber": (0.012, 0.014, 0.016, 1.0),
    "steel": (0.36, 0.42, 0.45, 1.0),
    "dark_metal": (0.035, 0.045, 0.052, 1.0),
    "visor": (0.003, 0.032, 0.045, 1.0),
    "number_cream": (0.98, 0.9, 0.7, 1.0),
}

MATERIAL_SPECS = {
    "teal": ("RRR_PlasticTeal", 0.55, 0.0),
    "coral": ("RRR_PlasticCoral", 0.55, 0.0),
    "cream": ("RRR_PlateCream", 0.66, 0.0),
    "navy": ("RRR_RiderArmor", 0.61, 0.0),
    "charcoal": ("RRR_RiderFabric", 0.84, 0.0),
    "rubber": ("RRR_Rubber", 0.94, 0.0),
    "steel": ("RRR_MetalBright", 0.36, 0.78),
    "dark_metal": ("RRR_MetalDark", 0.48, 0.68),
    "visor": ("RRR_Visor", 0.24, 0.08),
    "number_cream": ("RRR_NumberCream", 0.7, 0.0),
}

ROOT_NAME = "RRR_HeroBikeRider"
REQUIRED_NODE_NAMES = (
    ROOT_NAME,
    "RRR_BikeVisual",
    "player-rider",
    "bike-steering-pivot",
    "bike-front-suspension-pivot",
    "bike-rear-suspension-pivot",
    "FrontTire",
    "RearTire",
    "rider-torso-pivot",
    "rider-head-pivot",
    "rider-left-arm-pivot",
    "rider-right-arm-pivot",
    "rider-left-leg-pivot",
    "rider-right-leg-pivot",
    "bike-seat-anchor",
    "bike-left-hand-anchor",
    "bike-right-hand-anchor",
    "bike-left-boot-anchor",
    "bike-right-boot-anchor",
)

PUBLIC_NODE_NAMES = (
    ROOT_NAME,
    "RRR_BikeVisual",
    "Bike_ChassisShell",
    "Bike_TankAndRadiator",
    "Bike_Seat",
    "Bike_RearFender",
    "Bike_LeftSidePanel",
    "Bike_RightSidePanel",
    "Bike_Engine",
    "Bike_Exhaust",
    "Bike_ChainDrive",
    "bike-steering-pivot",
    "Bike_Handlebar",
    "Bike_FrontFork",
    "Bike_FrontFender",
    "NumberPlate",
    "bike-front-suspension-pivot",
    "FrontTire",
    "FrontTireRing",
    "FrontTreadRing",
    "FrontHub",
    "FrontSpokes",
    "FrontBrakeDisc",
    "bike-rear-suspension-pivot",
    "Bike_Swingarm",
    "RearTire",
    "RearTireRing",
    "RearTreadRing",
    "RearHub",
    "RearSpokes",
    "RearBrakeDisc",
    "RearNumberPanel",
    "RearNumber22",
    "bike-seat-anchor",
    "bike-left-hand-anchor",
    "bike-right-hand-anchor",
    "bike-left-boot-anchor",
    "bike-right-boot-anchor",
    "player-rider",
    "rider-torso-pivot",
    "Rider_Torso",
    "Rider_ChestArmor",
    "Rider_BackPlate",
    "JerseyNumber22",
    "rider-head-pivot",
    "Rider_Head",
    "Rider_Helmet",
    "Rider_Visor",
    "Rider_HelmetPeak",
    "rider-left-arm-pivot",
    "Rider_LeftArm",
    "rider-right-arm-pivot",
    "Rider_RightArm",
    "Rider_Hips",
    "rider-left-leg-pivot",
    "Rider_LeftLeg",
    "rider-right-leg-pivot",
    "Rider_RightLeg",
)

MATERIALS: dict[str, bpy.types.Material] = {}
NAME_COUNTS: dict[str, int] = {}
ASSET_COLLECTION: bpy.types.Collection
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
    parser = argparse.ArgumentParser(description="Build the hero bike and rider")
    parser.add_argument(
        "--output-dir",
        default="art-source/blender/hero-bike-rider/generated",
        help="Directory for the canonical .blend and raw .glb",
    )
    return parser.parse_args(values)


def create_materials() -> None:
    MATERIALS.clear()
    for key, color in PALETTE.items():
        material_name, roughness, metallic = MATERIAL_SPECS[key]
        mat = bpy.data.materials.new(material_name)
        mat.diffuse_color = color
        mat.use_nodes = True
        mat.use_backface_culling = False
        node = mat.node_tree.nodes.get("Principled BSDF")
        if node is not None:
            node.inputs["Base Color"].default_value = color
            node.inputs["Roughness"].default_value = roughness
            node.inputs["Metallic"].default_value = metallic
        MATERIALS[key] = mat


def stable_name(name: str) -> str:
    count = NAME_COUNTS.get(name, 0) + 1
    NAME_COUNTS[name] = count
    return name if count == 1 else f"{name}_{count:02d}"


def link_to_asset(obj: bpy.types.Object) -> None:
    for collection in tuple(obj.users_collection):
        collection.objects.unlink(obj)
    ASSET_COLLECTION.objects.link(obj)


def parent_to(obj: bpy.types.Object, parent: bpy.types.Object) -> bpy.types.Object:
    obj.parent = parent
    obj.matrix_parent_inverse.identity()
    return obj


def assign_material(obj: bpy.types.Object, key: str) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(MATERIALS[key])


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


def finish_mesh(
    obj: bpy.types.Object,
    key: str,
    bevel_width: float = 0.0,
    *,
    smooth: bool = False,
) -> bpy.types.Object:
    link_to_asset(obj)
    apply_mesh_transform(obj)
    assign_material(obj, key)
    bevel(obj, bevel_width)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return obj


def empty(
    name: str,
    location: tuple[float, float, float],
    parent: bpy.types.Object | None = None,
    *,
    display_size: float = 0.16,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = display_size
    obj.location = location
    ASSET_COLLECTION.objects.link(obj)
    if parent is not None:
        parent_to(obj, parent)
    return obj


def box(
    name: str,
    size: tuple[float, float, float],
    location: tuple[float, float, float],
    key: str,
    parent: bpy.types.Object,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel_width: float = 0.025,
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
    vertices: int = 12,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel_width: float = 0.015,
    smooth: bool = False,
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
    finish_mesh(obj, key, bevel_width, smooth=smooth)
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
    vertices: int = 10,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
    bevel_width: float = 0.018,
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
    subdivisions: int = 2,
    smooth: bool = False,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=subdivisions,
        radius=1.0,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = stable_name(name)
    obj.scale = (size[0] * 0.5, size[1] * 0.5, size[2] * 0.5)
    finish_mesh(obj, key, smooth=smooth)
    return parent_to(obj, parent)


def torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    location: tuple[float, float, float],
    key: str,
    parent: bpy.types.Object,
    *,
    major_segments: int = 20,
    minor_segments: int = 8,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = stable_name(name)
    finish_mesh(obj, key, smooth=True)
    return parent_to(obj, parent)


def mesh_object(
    name: str,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    key: str,
    parent: bpy.types.Object,
    *,
    bevel_width: float = 0.0,
    smooth: bool = False,
) -> bpy.types.Object:
    object_name = stable_name(name)
    mesh = bpy.data.meshes.new(f"{object_name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(object_name, mesh)
    ASSET_COLLECTION.objects.link(obj)
    assign_material(obj, key)
    bevel(obj, bevel_width)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return parent_to(obj, parent)


def ring_shell(
    name: str,
    rings: tuple[tuple[float, float, float, float], ...],
    location: tuple[float, float, float],
    key: str,
    parent: bpy.types.Object,
    *,
    segments: int = 16,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    """Create a faceted organic shell from Z/Y/width/depth cross sections."""
    vertices: list[tuple[float, float, float]] = []
    for z, y_offset, width, depth in rings:
        for index in range(segments):
            angle = index / segments * math.tau
            vertices.append((
                math.cos(angle) * width * 0.5,
                y_offset + math.sin(angle) * depth * 0.5,
                z,
            ))
    faces: list[tuple[int, ...]] = [
        tuple(range(segments - 1, -1, -1)),
        tuple(range((len(rings) - 1) * segments, len(rings) * segments)),
    ]
    for ring_index in range(len(rings) - 1):
        start = ring_index * segments
        following = start + segments
        for index in range(segments):
            next_index = (index + 1) % segments
            faces.append((
                start + index,
                start + next_index,
                following + next_index,
                following + index,
            ))
    obj = mesh_object(name, vertices, faces, key, parent, smooth=True)
    obj.location = location
    obj.rotation_euler = rotation
    apply_mesh_transform(obj)
    return obj


def extruded_polygon(
    name: str,
    points: tuple[tuple[float, float], ...],
    center: tuple[float, float, float],
    scale: float,
    depth: float,
    u_axis: tuple[float, float, float],
    v_axis: tuple[float, float, float],
    depth_axis: tuple[float, float, float],
    key: str,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    """Extrude one authored 2D silhouette in an arbitrary local plane."""
    origin = Vector(center)
    u = Vector(u_axis)
    v = Vector(v_axis)
    normal = Vector(depth_axis)
    half_depth = depth * 0.5
    vertices: list[tuple[float, float, float]] = []
    for side in (-1.0, 1.0):
        for point_u, point_v in points:
            position = (
                origin
                + u * (point_u * scale)
                + v * (point_v * scale)
                + normal * (side * half_depth)
            )
            vertices.append(tuple(position))
    count = len(points)
    faces: list[tuple[int, ...]] = [
        tuple(range(count - 1, -1, -1)),
        tuple(range(count, count * 2)),
    ]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    return mesh_object(name, vertices, faces, key, parent)


def side_prism(
    name: str,
    x_center: float,
    thickness: float,
    profile: tuple[tuple[float, float], ...],
    key: str,
    parent: bpy.types.Object,
    *,
    bevel_width: float = 0.018,
) -> bpy.types.Object:
    """Create an angular side plastic from a clockwise Y/Z silhouette."""
    half = thickness * 0.5
    vertices = [
        (x_center + offset, y, z)
        for offset in (-half, half)
        for y, z in profile
    ]
    count = len(profile)
    faces: list[tuple[int, ...]] = [
        tuple(range(count - 1, -1, -1)),
        tuple(range(count, count * 2)),
    ]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    return mesh_object(name, vertices, faces, key, parent, bevel_width=bevel_width)


def tapered_box(
    name: str,
    front_size: tuple[float, float],
    rear_size: tuple[float, float],
    length: float,
    location: tuple[float, float, float],
    key: str,
    parent: bpy.types.Object,
    *,
    bevel_width: float = 0.025,
) -> bpy.types.Object:
    front_y = length * 0.5
    rear_y = -length * 0.5
    fw, fh = front_size
    rw, rh = rear_size
    vertices = [
        (-fw / 2, front_y, -fh / 2),
        (fw / 2, front_y, -fh / 2),
        (fw / 2, front_y, fh / 2),
        (-fw / 2, front_y, fh / 2),
        (-rw / 2, rear_y, -rh / 2),
        (rw / 2, rear_y, -rh / 2),
        (rw / 2, rear_y, rh / 2),
        (-rw / 2, rear_y, rh / 2),
    ]
    faces = [
        (0, 1, 2, 3),
        (5, 4, 7, 6),
        (4, 0, 3, 7),
        (1, 5, 6, 2),
        (3, 2, 6, 7),
        (4, 5, 1, 0),
    ]
    obj = mesh_object(name, vertices, faces, key, parent, bevel_width=bevel_width)
    obj.location = location
    return obj


def cylinder_between(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius: float,
    key: str,
    parent: bpy.types.Object,
    *,
    vertices: int = 10,
    bevel_width: float = 0.008,
) -> bpy.types.Object:
    a = Vector(start)
    b = Vector(end)
    delta = b - a
    midpoint = (a + b) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=delta.length,
        location=tuple(midpoint),
    )
    obj = bpy.context.object
    obj.name = stable_name(name)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(delta.normalized())
    finish_mesh(obj, key, bevel_width)
    obj.rotation_mode = "XYZ"
    return parent_to(obj, parent)


def frustum_between(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    start_radius: float,
    end_radius: float,
    key: str,
    parent: bpy.types.Object,
    *,
    vertices: int = 12,
) -> bpy.types.Object:
    """Create a smooth tapered limb or mechanical member between two points."""
    a = Vector(start)
    b = Vector(end)
    delta = b - a
    midpoint = (a + b) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=start_radius,
        radius2=end_radius,
        depth=delta.length,
        location=tuple(midpoint),
    )
    obj = bpy.context.object
    obj.name = stable_name(name)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(delta.normalized())
    finish_mesh(obj, key, smooth=True)
    obj.rotation_mode = "XYZ"
    return parent_to(obj, parent)


def join_as(name: str, objects: list[bpy.types.Object]) -> bpy.types.Object:
    if not objects:
        raise ValueError(f"Cannot join an empty object set for {name}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = name
    joined.select_set(False)
    return joined


NUMBER_TWO_PROFILE = (
    (-0.5, 0.23),
    (-0.5, 0.32),
    (-0.32, 0.5),
    (0.32, 0.5),
    (0.5, 0.32),
    (0.5, 0.1),
    (0.34, -0.05),
    (-0.16, -0.22),
    (-0.32, -0.35),
    (0.5, -0.35),
    (0.5, -0.5),
    (-0.5, -0.5),
    (-0.5, -0.31),
    (-0.34, -0.12),
    (0.15, 0.05),
    (0.28, 0.17),
    (0.28, 0.27),
    (0.18, 0.33),
    (-0.18, 0.33),
    (-0.28, 0.23),
)

LIGHTNING_FLASH_PROFILE = (
    (-0.46, 0.12),
    (-0.08, 0.32),
    (-0.2, 0.05),
    (0.42, 0.18),
    (0.02, -0.34),
    (0.12, -0.05),
)

FIVE_POINT_STAR_PROFILE = (
    (0.0, 0.5),
    (0.12, 0.16),
    (0.48, 0.15),
    (0.19, -0.06),
    (0.3, -0.4),
    (0.0, -0.19),
    (-0.3, -0.4),
    (-0.19, -0.06),
    (-0.48, 0.15),
    (-0.12, 0.16),
)


def add_number_22(
    name: str,
    center: tuple[float, float, float],
    scale: float,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    assembly = empty(name, center, parent, display_size=0.06)
    parts: list[bpy.types.Object] = []
    for digit, center_x in (("L", -0.15), ("R", 0.15)):
        parts.append(extruded_polygon(
            f"{name}_{digit}",
            NUMBER_TWO_PROFILE,
            (center_x * scale, -0.014, 0.0),
            scale * 0.25,
            0.026,
            (1.0, 0.0, 0.0),
            (0.0, 0.0, 1.0),
            (0.0, 1.0, 0.0),
            "number_cream",
            assembly,
        ))
    joined = join_as(f"{name}_Geometry", parts)
    joined["glyph"] = "22"
    joined["glyph_style"] = "authored extruded race numeral"
    return assembly


def add_side_number_22(
    name: str,
    x_center: float,
    y_center: float,
    z_center: float,
    scale: float,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    """Mount a readable outward-facing 22 on either teal side panel."""
    # Screen-right maps to +Y on the rider-right side and -Y on rider-left.
    # Keeping that mapping explicit prevents one side's glyph from reading mirrored.
    horizontal_sign = 1.0 if x_center > 0.0 else -1.0
    parts: list[bpy.types.Object] = []
    for digit, digit_center in (("L", -0.15), ("R", 0.15)):
        parts.append(extruded_polygon(
            f"{name}_{digit}",
            NUMBER_TWO_PROFILE,
            (
                x_center,
                y_center + digit_center * scale * horizontal_sign,
                z_center,
            ),
            scale * 0.25,
            0.026,
            (0.0, horizontal_sign, 0.0),
            (0.0, 0.0, 1.0),
            (1.0, 0.0, 0.0),
            "number_cream",
            parent,
        ))
    joined = join_as(name, parts)
    joined["glyph"] = "22"
    joined["mount"] = "outward-facing teal side panel"
    joined["glyph_style"] = "authored extruded race numeral"
    return joined


def add_side_decal(
    name: str,
    profile: tuple[tuple[float, float], ...],
    x_center: float,
    y_center: float,
    z_center: float,
    scale: float,
    key: str,
    parent: bpy.types.Object,
    *,
    depth: float = 0.02,
) -> bpy.types.Object:
    """Add a thin outward-facing graphic flash on side plastics or rider gear."""
    horizontal_sign = 1.0 if x_center > 0.0 else -1.0
    decal = extruded_polygon(
        name,
        profile,
        (x_center, y_center, z_center),
        scale,
        depth,
        (0.0, horizontal_sign, 0.0),
        (0.0, 0.0, 1.0),
        (1.0, 0.0, 0.0),
        key,
        parent,
    )
    decal["graphic_style"] = "authored raised mesh decal"
    return decal


def add_wheel(
    name: str,
    location: tuple[float, float, float],
    parent: bpy.types.Object,
    *,
    rear: bool,
) -> bpy.types.Object:
    wheel = empty(name, location, parent, display_size=0.22)
    wheel["animated_axis"] = "+X"
    wheel["outer_radius_m"] = 0.63

    torus(
        f"{name}Ring",
        0.49,
        0.095,
        (0.0, 0.0, 0.0),
        "rubber",
        wheel,
        major_segments=36,
        minor_segments=12,
        rotation=(0.0, math.pi / 2, 0.0),
    )
    tread_vertices: list[tuple[float, float, float]] = []
    tread_faces: list[tuple[int, ...]] = []

    def append_knob(
        center_x: float,
        angle: float,
        radius: float,
        axial_width: float,
        tangent_length: float,
        radial_height: float,
    ) -> None:
        radial = Vector((0.0, math.sin(angle), math.cos(angle)))
        tangent = Vector((0.0, math.cos(angle), -math.sin(angle)))
        axial = Vector((1.0, 0.0, 0.0))
        center = Vector((center_x, 0.0, 0.0)) + radial * radius
        start = len(tread_vertices)
        for radial_sign in (-1.0, 1.0):
            for tangent_sign in (-1.0, 1.0):
                for axial_sign in (-1.0, 1.0):
                    position = (
                        center
                        + axial * (axial_sign * axial_width * 0.5)
                        + tangent * (tangent_sign * tangent_length * 0.5)
                        + radial * (radial_sign * radial_height * 0.5)
                    )
                    tread_vertices.append(tuple(position))
        tread_faces.extend((
            (start + 0, start + 1, start + 3, start + 2),
            (start + 4, start + 6, start + 7, start + 5),
            (start + 0, start + 4, start + 5, start + 1),
            (start + 2, start + 3, start + 7, start + 6),
            (start + 0, start + 2, start + 6, start + 4),
            (start + 1, start + 5, start + 7, start + 3),
        ))

    tread_count = 24
    for index in range(tread_count):
        angle = index / tread_count * math.tau
        append_knob(0.0, angle, 0.598, 0.135, 0.078, 0.064)
        shoulder_angle = angle + math.pi / tread_count
        append_knob(-0.112, shoulder_angle, 0.597, 0.09, 0.07, 0.06)
        append_knob(0.112, shoulder_angle, 0.597, 0.09, 0.07, 0.06)
    tread = mesh_object(
        f"{name.replace('Tire', '')}TreadRing",
        tread_vertices,
        tread_faces,
        "rubber",
        wheel,
    )
    tread["block_count"] = tread_count * 3
    tread["tread_pattern"] = "direct staggered center and shoulder crown"

    sidewall_parts: list[bpy.types.Object] = []
    for side_x, side_name in ((-0.126, "L"), (0.126, "R")):
        sidewall_parts.extend([
            torus(
                f"{name}SidewallOuterBead{side_name}",
                0.515,
                0.009,
                (side_x, 0.0, 0.0),
                "rubber",
                wheel,
                major_segments=36,
                minor_segments=4,
                rotation=(0.0, math.pi / 2, 0.0),
            ),
            torus(
                f"{name}SidewallInnerBead{side_name}",
                0.43,
                0.006,
                (side_x, 0.0, 0.0),
                "rubber",
                wheel,
                major_segments=32,
                minor_segments=4,
                rotation=(0.0, math.pi / 2, 0.0),
            ),
        ])
        for index in range(12):
            angle = index / 12 * math.tau + (0.04 if side_x > 0 else -0.04)
            radius = 0.477
            sidewall_parts.append(box(
                f"{name}SidewallDash{side_name}",
                (0.011, 0.07, 0.018),
                (side_x, math.sin(angle) * radius, math.cos(angle) * radius),
                "rubber",
                wheel,
                rotation=(0.0, 0.0, -angle),
                bevel_width=0.004,
            ))
    sidewalls = join_as(f"{name.replace('Tire', '')}SidewallDetail", sidewall_parts)
    sidewalls["sidewall_detail"] = "raised bead rings and readable dash ribs"

    spoke_parts: list[bpy.types.Object] = [
        torus(f"{name}Rim", 0.355, 0.018, (0.0, 0.0, 0.0), "steel", wheel, major_segments=28, minor_segments=6, rotation=(0.0, math.pi / 2, 0.0)),
    ]
    for side_x in (-0.055, 0.055):
        for index in range(16):
            angle = (index / 16) * math.tau + (0.1 if side_x > 0 else 0.0)
            spoke_parts.append(cylinder_between(
                f"{name}Spoke",
                (side_x, 0.0, 0.0),
                (-side_x * 0.18, math.sin(angle) * 0.35, math.cos(angle) * 0.35),
                0.0065,
                "steel",
                wheel,
                vertices=6,
                bevel_width=0.0,
            ))
    join_as(f"{name.replace('Tire', '')}Spokes", spoke_parts)
    cylinder(f"{name.replace('Tire', '')}Hub", 0.095, 0.21, (0.0, 0.0, 0.0), "steel", wheel, vertices=14, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.01)
    torus(f"{name.replace('Tire', '')}BrakeDisc", 0.18, 0.018, (0.11, 0.0, 0.0), "steel", wheel, major_segments=24, minor_segments=6, rotation=(0.0, math.pi / 2, 0.0))
    rotor_detail_parts: list[bpy.types.Object] = []
    for ring_radius, slot_count, slot_length in ((0.18, 6, 0.048),):
        for index in range(slot_count):
            angle = index / slot_count * math.tau + (0.12 if ring_radius > 0.16 else 0.0)
            rotor_detail_parts.append(box(
                f"{name}BrakeRotorRaisedSlot",
                (0.009, slot_length, 0.014),
                (0.128, math.sin(angle) * ring_radius, math.cos(angle) * ring_radius),
                "steel",
                wheel,
                rotation=(angle, 0.0, 0.0),
                bevel_width=0.0,
            ))
    for index in range(4):
        angle = index / 4 * math.tau + 0.18
        rotor_detail_parts.append(cylinder(
            f"{name}HubBolt",
            0.013,
            0.013,
            (0.132, math.sin(angle) * 0.115, math.cos(angle) * 0.115),
            "steel",
            wheel,
            vertices=6,
            rotation=(0.0, math.pi / 2, 0.0),
            bevel_width=0.0,
        ))
    rotor_detail = join_as(f"{name.replace('Tire', '')}BrakeRotorHardware", rotor_detail_parts)
    rotor_detail["brake_detail"] = "raised rotor slots and hub bolts"
    box(f"{name}BrakeCaliper", (0.065, 0.1, 0.19), (0.13, 0.17, -0.03), "steel", wheel, rotation=(0.18, 0.0, 0.0), bevel_width=0.014)
    if rear:
        cylinder("RearSprocket", 0.235, 0.025, (-0.12, 0.0, 0.0), "steel", wheel, vertices=20, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.006)
    return wheel


def add_bike(root: bpy.types.Object) -> bpy.types.Object:
    bike = empty("RRR_BikeVisual", (0.0, 0.0, 0.0), root, display_size=0.35)
    bike["presentation_only"] = True
    bike["wheelbase_m"] = 2.36

    chassis_parts = [
        cylinder_between("FrameTop", (-0.22, -0.58, 1.12), (-0.18, 0.49, 1.29), 0.052, "coral", bike),
        cylinder_between("FrameTop", (0.22, -0.58, 1.12), (0.18, 0.49, 1.29), 0.052, "coral", bike),
        cylinder_between("FrameDown", (-0.18, 0.49, 1.28), (-0.21, -0.05, 0.65), 0.057, "dark_metal", bike),
        cylinder_between("FrameDown", (0.18, 0.49, 1.28), (0.21, -0.05, 0.65), 0.057, "dark_metal", bike),
        cylinder_between("FrameCradle", (-0.21, -0.05, 0.65), (-0.22, -0.63, 0.72), 0.048, "dark_metal", bike),
        cylinder_between("FrameCradle", (0.21, -0.05, 0.65), (0.22, -0.63, 0.72), 0.048, "dark_metal", bike),
        cylinder_between("FrameRear", (-0.22, -0.63, 0.72), (-0.22, -0.72, 1.11), 0.052, "dark_metal", bike),
        cylinder_between("FrameRear", (0.22, -0.63, 0.72), (0.22, -0.72, 1.11), 0.052, "dark_metal", bike),
        box("FrameCrossmember", (0.49, 0.11, 0.1), (0.0, -0.55, 0.75), "dark_metal", bike, bevel_width=0.018),
    ]
    join_as("Bike_ChassisShell", chassis_parts)

    engine_parts = [
        box("EngineBlock", (0.36, 0.38, 0.32), (0.0, -0.02, 0.75), "steel", bike, rotation=(0.08, 0.0, 0.0), bevel_width=0.055),
        ring_shell(
            "EngineCrankcase",
            ((-0.16, 0.0, 0.3, 0.28), (-0.04, 0.0, 0.45, 0.4), (0.12, 0.0, 0.4, 0.36), (0.18, 0.0, 0.24, 0.22)),
            (0.0, -0.06, 0.69),
            "steel",
            bike,
            segments=14,
        ),
        cylinder("EngineCoverR", 0.205, 0.068, (0.265, -0.04, 0.7), "steel", bike, vertices=12, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.014),
        cylinder("EngineCoverRInset", 0.125, 0.022, (0.31, -0.04, 0.7), "dark_metal", bike, vertices=12, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.008),
        cylinder("EngineCoverL", 0.175, 0.055, (-0.26, -0.05, 0.71), "steel", bike, vertices=12, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.011),
        cylinder("EngineCoverLInset", 0.105, 0.02, (-0.298, -0.05, 0.71), "dark_metal", bike, vertices=12, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.007),
        box("EngineHead", (0.35, 0.26, 0.25), (0.0, 0.18, 0.97), "dark_metal", bike, rotation=(-0.14, 0.0, 0.0), bevel_width=0.04),
        box("EngineFinLower", (0.46, 0.3, 0.024), (0.0, 0.17, 0.9), "steel", bike, rotation=(-0.14, 0.0, 0.0), bevel_width=0.006),
        box("EngineFinMiddle", (0.47, 0.3, 0.024), (0.0, 0.18, 0.98), "steel", bike, rotation=(-0.14, 0.0, 0.0), bevel_width=0.006),
        box("EngineFinUpper", (0.44, 0.28, 0.024), (0.0, 0.19, 1.06), "steel", bike, rotation=(-0.14, 0.0, 0.0), bevel_width=0.006),
        box("EngineDarkFinGapLower", (0.5, 0.028, 0.028), (0.0, 0.315, 0.935), "dark_metal", bike, rotation=(-0.14, 0.0, 0.0), bevel_width=0.004),
        box("EngineDarkFinGapUpper", (0.47, 0.026, 0.026), (0.0, 0.327, 1.02), "dark_metal", bike, rotation=(-0.14, 0.0, 0.0), bevel_width=0.004),
        box("EngineSparkPlugCap", (0.09, 0.07, 0.12), (0.0, 0.35, 1.13), "dark_metal", bike, rotation=(-0.18, 0.0, 0.0), bevel_width=0.014),
        box("SkidPlate", (0.52, 0.52, 0.07), (0.0, -0.03, 0.44), "steel", bike, rotation=(0.04, 0.0, 0.0), bevel_width=0.022),
    ]
    for side_x, cover_radius, y_center, z_center in ((0.317, 0.105, -0.04, 0.7), (-0.312, 0.088, -0.05, 0.71)):
        for index in range(6):
            angle = index / 6 * math.tau + 0.2
            engine_parts.append(cylinder(
                "EngineCoverBolt",
                0.018,
                0.018,
                (side_x, y_center + math.sin(angle) * cover_radius, z_center + math.cos(angle) * cover_radius),
                "dark_metal",
                bike,
                vertices=8,
                rotation=(0.0, math.pi / 2, 0.0),
                bevel_width=0.004,
            ))
    for index, z_offset in enumerate((0.86, 0.93, 1.0, 1.07)):
        engine_parts.append(box(
            "EngineSideCoolingRib",
            (0.56 - index * 0.025, 0.032, 0.026),
            (0.0, 0.345 + index * 0.006, z_offset),
            "dark_metal",
            bike,
            rotation=(-0.14, 0.0, 0.0),
            bevel_width=0.004,
        ))
    join_as("Bike_Engine", engine_parts)

    tank_parts = [
        tapered_box("TankCore", (0.44, 0.34), (0.32, 0.27), 0.68, (0.0, 0.17, 1.23), "coral", bike, bevel_width=0.055),
        tapered_box("TankTealInset", (0.37, 0.2), (0.27, 0.15), 0.57, (0.0, 0.14, 1.39), "teal", bike, bevel_width=0.03),
        tapered_box("TankCreamCenterStripe", (0.13, 0.055), (0.08, 0.045), 0.6, (0.0, 0.145, 1.54), "number_cream", bike, bevel_width=0.011),
        cylinder("TankCapRaised", 0.055, 0.024, (0.0, 0.405, 1.42), "dark_metal", bike, vertices=12, rotation=(math.pi / 2, 0.0, 0.0), bevel_width=0.006),
        box("RadiatorL", (0.055, 0.34, 0.37), (-0.245, 0.14, 1.01), "dark_metal", bike, rotation=(-0.11, 0.05, 0.0), bevel_width=0.019),
        box("RadiatorR", (0.055, 0.34, 0.37), (0.245, 0.14, 1.01), "dark_metal", bike, rotation=(-0.11, -0.05, 0.0), bevel_width=0.019),
        cylinder_between("RadiatorHoseL", (-0.23, 0.22, 1.14), (-0.11, 0.31, 1.25), 0.022, "dark_metal", bike, vertices=8, bevel_width=0.003),
        cylinder_between("RadiatorHoseR", (0.23, 0.22, 1.14), (0.11, 0.31, 1.25), 0.022, "dark_metal", bike, vertices=8, bevel_width=0.003),
    ]
    for side_x, side_rotation in ((-0.286, 0.05), (0.286, -0.05)):
        for index in range(5):
            tank_parts.append(box(
                "RadiatorLouver",
                (0.03, 0.285, 0.018),
                (side_x, 0.145 + index * 0.012, 0.875 + index * 0.062),
                "steel",
                bike,
                rotation=(-0.11, side_rotation, 0.0),
                bevel_width=0.004,
            ))
    join_as("Bike_TankAndRadiator", tank_parts)

    side_prism(
        "Bike_Seat",
        0.0,
        0.34,
        ((0.12, 1.4), (-0.25, 1.49), (-0.7, 1.49), (-1.0, 1.42), (-0.94, 1.3), (-0.36, 1.33), (0.1, 1.34)),
        "dark_metal",
        bike,
        bevel_width=0.035,
    )

    left_panel_parts = [
        side_prism("LeftShroud", -0.29, 0.12, ((0.46, 1.39), (0.39, 1.06), (0.03, 0.93), (-0.37, 1.11), (-0.33, 1.34)), "teal", bike, bevel_width=0.028),
        side_prism("LeftRearPlate", -0.3, 0.105, ((-0.36, 1.34), (-0.46, 1.08), (-0.93, 1.08), (-1.03, 1.28), (-0.73, 1.39)), "teal", bike, bevel_width=0.026),
        side_prism("LeftRearDarkNumberField", -0.366, 0.038, ((-0.53, 1.33), (-0.6, 1.15), (-0.9, 1.14), (-0.97, 1.26), (-0.78, 1.34)), "dark_metal", bike, bevel_width=0.014),
        side_prism("LeftRearCoralPlateLip", -0.386, 0.03, ((-0.55, 1.35), (-0.61, 1.29), (-0.79, 1.35), (-0.73, 1.39)), "coral", bike, bevel_width=0.01),
        side_prism("LeftCoralSlash", -0.365, 0.035, ((0.27, 1.35), (0.2, 1.13), (-0.02, 1.02), (0.05, 1.16)), "coral", bike, bevel_width=0.012),
        add_side_decal("LeftShroudCreamLightning", LIGHTNING_FLASH_PROFILE, -0.386, 0.18, 1.19, 0.34, "number_cream", bike, depth=0.018),
        add_side_decal("LeftShroudCoralStar", FIVE_POINT_STAR_PROFILE, -0.39, 0.03, 1.16, 0.12, "coral", bike, depth=0.016),
        add_side_decal("LeftRearPlateCreamSlash", LIGHTNING_FLASH_PROFILE, -0.395, -0.78, 1.23, 0.22, "number_cream", bike, depth=0.016),
        add_side_number_22("LeftSideNumber22", -0.372, -0.71, 1.235, 0.66, bike),
    ]
    join_as("Bike_LeftSidePanel", left_panel_parts)
    right_panel_parts = [
        side_prism("RightShroud", 0.29, 0.12, ((0.46, 1.39), (0.39, 1.06), (0.03, 0.93), (-0.37, 1.11), (-0.33, 1.34)), "teal", bike, bevel_width=0.028),
        side_prism("RightRearPlate", 0.3, 0.105, ((-0.36, 1.34), (-0.46, 1.08), (-0.93, 1.08), (-1.03, 1.28), (-0.73, 1.39)), "teal", bike, bevel_width=0.026),
        side_prism("RightRearDarkNumberField", 0.366, 0.038, ((-0.53, 1.33), (-0.6, 1.15), (-0.9, 1.14), (-0.97, 1.26), (-0.78, 1.34)), "dark_metal", bike, bevel_width=0.014),
        side_prism("RightRearCoralPlateLip", 0.386, 0.03, ((-0.55, 1.35), (-0.61, 1.29), (-0.79, 1.35), (-0.73, 1.39)), "coral", bike, bevel_width=0.01),
        side_prism("RightCoralSlash", 0.365, 0.035, ((0.27, 1.35), (0.2, 1.13), (-0.02, 1.02), (0.05, 1.16)), "coral", bike, bevel_width=0.012),
        add_side_decal("RightShroudCreamLightning", LIGHTNING_FLASH_PROFILE, 0.386, 0.18, 1.19, 0.34, "number_cream", bike, depth=0.018),
        add_side_decal("RightShroudCoralStar", FIVE_POINT_STAR_PROFILE, 0.39, 0.03, 1.16, 0.12, "coral", bike, depth=0.016),
        add_side_decal("RightRearPlateCreamSlash", LIGHTNING_FLASH_PROFILE, 0.395, -0.78, 1.23, 0.22, "number_cream", bike, depth=0.016),
        add_side_number_22("RightSideNumber22", 0.372, -0.71, 1.235, 0.66, bike),
    ]
    join_as("Bike_RightSidePanel", right_panel_parts)

    rear_fender_parts = [
        side_prism("RearFenderCoral", 0.0, 0.34, ((-0.45, 1.36), (-0.75, 1.46), (-1.22, 1.47), (-1.66, 1.39), (-1.7, 1.31), (-1.22, 1.35), (-0.72, 1.34)), "coral", bike, bevel_width=0.023),
        side_prism("RearFenderTealRidge", 0.0, 0.18, ((-0.74, 1.46), (-1.17, 1.5), (-1.59, 1.41), (-1.46, 1.38), (-1.05, 1.43)), "teal", bike, bevel_width=0.014),
        side_prism("RearFenderCreamTipFlash", 0.0, 0.12, ((-1.06, 1.47), (-1.49, 1.42), (-1.63, 1.36), (-1.39, 1.36), (-1.06, 1.42)), "number_cream", bike, bevel_width=0.009),
        side_prism("RearFenderUndersideShadow", 0.0, 0.24, ((-0.82, 1.32), (-1.42, 1.33), (-1.61, 1.3), (-1.38, 1.25), (-0.86, 1.27)), "dark_metal", bike, bevel_width=0.01),
    ]
    join_as("Bike_RearFender", rear_fender_parts)

    exhaust_parts = [
        frustum_between("ExhaustCanister", (0.35, -0.54, 1.24), (0.35, -1.1, 1.28), 0.09, 0.13, "steel", bike, vertices=16),
        cylinder("ExhaustFrontBand", 0.098, 0.052, (0.35, -0.59, 1.245), "dark_metal", bike, vertices=14, rotation=(math.pi / 2, 0.0, 0.0), bevel_width=0.007),
        cylinder("ExhaustBand", 0.118, 0.065, (0.35, -0.78, 1.27), "dark_metal", bike, vertices=14, rotation=(math.pi / 2, 0.0, 0.0), bevel_width=0.009),
        cylinder("ExhaustEndCap", 0.118, 0.045, (0.35, -1.1, 1.27), "dark_metal", bike, vertices=14, rotation=(math.pi / 2, 0.0, 0.0), bevel_width=0.008),
        cylinder("ExhaustTip", 0.072, 0.15, (0.35, -1.17, 1.27), "dark_metal", bike, vertices=14, rotation=(math.pi / 2, 0.0, 0.0), bevel_width=0.01),
        cylinder("ExhaustTipLip", 0.081, 0.026, (0.35, -1.252, 1.27), "steel", bike, vertices=14, rotation=(math.pi / 2, 0.0, 0.0), bevel_width=0.006),
        cylinder_between("ExhaustHeader", (0.24, 0.17, 0.83), (0.34, -0.51, 1.2), 0.045, "steel", bike, vertices=10),
    ]
    for index in range(4):
        exhaust_parts.append(cylinder(
            "ExhaustHeatShieldBolt",
            0.015,
            0.014,
            (0.445, -0.66 - index * 0.105, 1.285 + index * 0.006),
            "dark_metal",
            bike,
            vertices=8,
            rotation=(0.0, math.pi / 2, 0.0),
            bevel_width=0.003,
        ))
    exhaust = join_as("Bike_Exhaust", exhaust_parts)
    authored_origin = Vector((0.39, -0.82, 1.02))
    origin_delta = Vector(exhaust.location) - authored_origin
    for vertex in exhaust.data.vertices:
        vertex.co += origin_delta
    exhaust.location = authored_origin
    exhaust["camera_side"] = "rear-right"

    rear_pivot = empty("bike-rear-suspension-pivot", (0.0, -0.4, 0.83), bike, display_size=0.13)
    swingarm_parts = [
        cylinder_between("SwingarmL", (-0.22, 0.0, 0.0), (-0.18, -0.78, -0.2), 0.064, "steel", rear_pivot),
        cylinder_between("SwingarmR", (0.22, 0.0, 0.0), (0.18, -0.78, -0.2), 0.064, "steel", rear_pivot),
        box("SwingarmBridge", (0.47, 0.11, 0.09), (0.0, -0.35, -0.09), "steel", rear_pivot, bevel_width=0.022),
        side_prism("SwingarmPlateL", -0.18, 0.085, ((-0.04, 0.07), (-0.12, -0.07), (-0.7, -0.22), (-0.81, -0.2), (-0.72, -0.1), (-0.11, 0.12)), "steel", rear_pivot, bevel_width=0.018),
        side_prism("SwingarmPlateR", 0.18, 0.085, ((-0.04, 0.07), (-0.12, -0.07), (-0.7, -0.22), (-0.81, -0.2), (-0.72, -0.1), (-0.11, 0.12)), "steel", rear_pivot, bevel_width=0.018),
        cylinder_between("RearShock", (0.0, -0.02, 0.17), (0.0, -0.48, 0.52), 0.05, "steel", rear_pivot),
    ]
    for index in range(5):
        factor = (index + 1) / 6
        y = -0.02 + (-0.48 + 0.02) * factor
        z = 0.17 + (0.52 - 0.17) * factor
        swingarm_parts.append(cylinder(
            "RearShockSpringBand",
            0.076,
            0.022,
            (0.0, y, z),
            "steel",
            rear_pivot,
            vertices=12,
            rotation=(math.pi / 2, 0.0, 0.0),
            bevel_width=0.004,
        ))
    shock_axis_start = Vector((0.0, -0.02, 0.17))
    shock_axis_end = Vector((0.0, -0.48, 0.52))
    shock_delta = shock_axis_end - shock_axis_start
    for index in range(4):
        start_factor = index / 4
        end_factor = (index + 0.52) / 4
        start_angle = index * 0.82
        end_angle = start_angle + 1.65
        start = shock_axis_start + shock_delta * start_factor + Vector((
            math.sin(start_angle) * 0.057,
            0.0,
            math.cos(start_angle) * 0.028,
        ))
        end = shock_axis_start + shock_delta * min(1.0, end_factor) + Vector((
            math.sin(end_angle) * 0.057,
            0.0,
            math.cos(end_angle) * 0.028,
        ))
        swingarm_parts.append(cylinder_between(
            "RearShockCoilSegment",
            tuple(start),
            tuple(end),
            0.011,
            "steel",
            rear_pivot,
            vertices=6,
            bevel_width=0.0,
        ))
    for y in (-0.08, -0.43):
        swingarm_parts.append(cylinder(
            "RearShockMountBolt",
            0.035,
            0.28,
            (0.0, y, 0.215 if y > -0.2 else 0.48),
            "steel",
            rear_pivot,
            vertices=6,
            rotation=(0.0, math.pi / 2, 0.0),
            bevel_width=0.0,
        ))
    join_as("Bike_Swingarm", swingarm_parts)
    add_wheel("RearTire", (0.0, -0.78, -0.2), rear_pivot, rear=True)

    chain_parts = [
        cylinder_between("ChainUpper", (-0.18, -0.52, 0.85), (-0.18, -1.18, 0.63), 0.016, "dark_metal", bike, vertices=6, bevel_width=0.0),
        cylinder_between("ChainLower", (-0.18, -0.52, 0.76), (-0.18, -1.18, 0.55), 0.016, "dark_metal", bike, vertices=6, bevel_width=0.0),
        cylinder("FrontSprocket", 0.13, 0.035, (-0.18, -0.5, 0.81), "dark_metal", bike, vertices=16, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.004),
    ]

    def add_chain_links(
        prefix: str,
        start: tuple[float, float, float],
        end: tuple[float, float, float],
    ) -> None:
        start_vector = Vector(start)
        delta = Vector(end) - start_vector
        chain_angle = math.atan2(delta.z, delta.y)
        for index in range(4):
            center = start_vector + delta * ((index + 0.5) / 4)
            chain_parts.append(box(
                f"{prefix}Plate",
                (0.052, 0.07, 0.018),
                tuple(center),
                "dark_metal",
                bike,
                rotation=(chain_angle, 0.0, 0.0),
                bevel_width=0.002,
            ))
            chain_parts.append(cylinder(
                f"{prefix}Roller",
                0.018,
                0.064,
                (center.x - 0.002, center.y, center.z),
                "dark_metal",
                bike,
                vertices=8,
                rotation=(0.0, math.pi / 2, 0.0),
                bevel_width=0.002,
            ))

    add_chain_links("ChainUpperLink", (-0.18, -0.52, 0.85), (-0.18, -1.18, 0.63))
    add_chain_links("ChainLowerLink", (-0.18, -0.52, 0.76), (-0.18, -1.18, 0.55))
    for index in range(12):
        tooth_angle = index / 12 * math.tau
        chain_parts.append(box(
            "FrontSprocketTooth",
            (0.046, 0.05, 0.022),
            (-0.18, -0.5 + math.sin(tooth_angle) * 0.145, 0.81 + math.cos(tooth_angle) * 0.145),
            "dark_metal",
            bike,
            rotation=(tooth_angle, 0.0, 0.0),
            bevel_width=0.004,
        ))
    chain_drive = join_as("Bike_ChainDrive", chain_parts)
    chain_drive["mechanical_detail"] = "visible link plates and front sprocket teeth"

    steering = empty("bike-steering-pivot", (0.0, 0.62, 1.53), bike, display_size=0.14)
    fork_pivot = empty("bike-front-suspension-pivot", (0.0, 0.0, 0.0), steering, display_size=0.12)
    fork_parts = [
        cylinder_between("ForkL", (-0.18, 0.0, 0.0), (-0.18, 0.56, -0.9), 0.047, "steel", steering),
        cylinder_between("ForkR", (0.18, 0.0, 0.0), (0.18, 0.56, -0.9), 0.047, "steel", steering),
        cylinder_between("ForkInnerTubeL", (-0.11, 0.03, -0.02), (-0.11, 0.52, -0.82), 0.023, "steel", steering, vertices=10, bevel_width=0.003),
        cylinder_between("ForkInnerTubeR", (0.11, 0.03, -0.02), (0.11, 0.52, -0.82), 0.023, "steel", steering, vertices=10, bevel_width=0.003),
        cylinder_between("ForkGuardL", (-0.18, 0.29, -0.45), (-0.18, 0.54, -0.86), 0.072, "coral", steering, vertices=8, bevel_width=0.012),
        cylinder_between("ForkGuardR", (0.18, 0.29, -0.45), (0.18, 0.54, -0.86), 0.072, "coral", steering, vertices=8, bevel_width=0.012),
        cylinder_between("ForkGuardCreamStripeL", (-0.181, 0.34, -0.5), (-0.181, 0.5, -0.77), 0.026, "cream", steering, vertices=6, bevel_width=0.004),
        cylinder_between("ForkGuardCreamStripeR", (0.181, 0.34, -0.5), (0.181, 0.5, -0.77), 0.026, "cream", steering, vertices=6, bevel_width=0.004),
        cylinder("FrontAxleCapL", 0.052, 0.035, (-0.22, 0.56, -0.9), "steel", steering, vertices=10, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.006),
        cylinder("FrontAxleCapR", 0.052, 0.035, (0.22, 0.56, -0.9), "steel", steering, vertices=10, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.006),
        cylinder("ForkTopAdjusterL", 0.04, 0.025, (-0.18, -0.012, 0.07), "steel", steering, vertices=6, bevel_width=0.0),
        cylinder("ForkTopAdjusterR", 0.04, 0.025, (0.18, -0.012, 0.07), "steel", steering, vertices=6, bevel_width=0.0),
        box("ForkTopSlotL", (0.058, 0.009, 0.012), (-0.18, -0.012, 0.096), "steel", steering, rotation=(0.0, 0.0, 0.38), bevel_width=0.0),
        box("ForkTopSlotR", (0.058, 0.009, 0.012), (0.18, -0.012, 0.096), "steel", steering, rotation=(0.0, 0.0, -0.38), bevel_width=0.0),
        box("LowerTripleClamp", (0.5, 0.11, 0.09), (0.0, 0.05, -0.18), "steel", steering, bevel_width=0.022),
        box("UpperTripleClamp", (0.52, 0.11, 0.09), (0.0, -0.01, 0.03), "steel", steering, bevel_width=0.022),
    ]
    join_as("Bike_FrontFork", fork_parts)
    add_wheel("FrontTire", (0.0, 0.56, -0.9), fork_pivot, rear=False)

    handlebar_parts = [
        cylinder_between("HandlebarL", (0.0, -0.03, 0.08), (-0.48, -0.03, 0.19), 0.025, "steel", steering, vertices=10),
        cylinder_between("HandlebarR", (0.0, -0.03, 0.08), (0.48, -0.03, 0.19), 0.025, "steel", steering, vertices=10),
        cylinder("GripL", 0.047, 0.2, (-0.53, -0.03, 0.2), "steel", steering, vertices=10, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.009),
        cylinder("GripR", 0.047, 0.2, (0.53, -0.03, 0.2), "steel", steering, vertices=10, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.009),
        cylinder("CrossbarPad", 0.04, 0.38, (0.0, -0.035, 0.155), "steel", steering, vertices=10, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.01),
        cylinder_between("BrakeCableL", (-0.31, -0.03, 0.15), (-0.18, 0.26, -0.28), 0.009, "steel", steering, vertices=6, bevel_width=0.0),
        cylinder_between("BrakeCableR", (0.31, -0.03, 0.15), (0.18, 0.26, -0.28), 0.009, "steel", steering, vertices=6, bevel_width=0.0),
        box("HandguardL", (0.24, 0.1, 0.12), (-0.58, 0.02, 0.21), "coral", steering, bevel_width=0.035),
        box("HandguardR", (0.24, 0.1, 0.12), (0.58, 0.02, 0.21), "coral", steering, bevel_width=0.035),
        box("HandguardCreamL", (0.13, 0.055, 0.055), (-0.6, 0.08, 0.235), "cream", steering, bevel_width=0.012),
        box("HandguardCreamR", (0.13, 0.055, 0.055), (0.6, 0.08, 0.235), "cream", steering, bevel_width=0.012),
    ]
    join_as("Bike_Handlebar", handlebar_parts)

    front_fender_parts = [
        side_prism("FrontFenderMain", 0.0, 0.36, ((0.04, -0.25), (0.38, -0.13), (0.82, -0.14), (1.03, -0.21), (0.95, -0.28), (0.5, -0.24), (0.05, -0.31)), "coral", steering, bevel_width=0.023),
        side_prism("FrontFenderRidge", 0.0, 0.18, ((0.28, -0.14), (0.62, -0.09), (0.91, -0.16), (0.76, -0.2), (0.39, -0.19)), "cream", steering, bevel_width=0.012),
        side_prism("FrontFenderCreamKnifeStripe", 0.0, 0.12, ((0.26, -0.22), (0.58, -0.16), (0.88, -0.2), (0.72, -0.23), (0.34, -0.24)), "cream", steering, bevel_width=0.008),
        side_prism("FrontFenderCreamTip", 0.0, 0.14, ((0.84, -0.18), (1.01, -0.21), (0.93, -0.26), (0.78, -0.23)), "cream", steering, bevel_width=0.008),
    ]
    join_as("Bike_FrontFender", front_fender_parts)
    side_prism("NumberPlate", 0.0, 0.46, ((0.05, -0.25), (0.14, 0.14), (0.07, 0.23), (-0.05, 0.18), (-0.1, -0.21)), "cream", steering, bevel_width=0.035)
    side_prism("NumberPlateCoralBorder", 0.0, 0.5, ((0.02, -0.28), (0.11, 0.17), (0.05, 0.26), (-0.08, 0.21), (-0.13, -0.24)), "coral", steering, bevel_width=0.03)
    front_plate = empty("FrontNumber22", (0.0, 0.04, 0.0), steering, display_size=0.05)
    front_plate.rotation_euler.x = -0.04
    front_digits = add_number_22("FrontNumber22Digits", (0.0, -0.11, -0.05), 0.34, front_plate)
    for digit_part in descendants(front_digits):
        if digit_part.type == "MESH":
            assign_material(digit_part, "cream")

    rear_plate = empty("RearNumberPanel", (0.0, -1.76, 1.24), bike, display_size=0.08)
    box("RearNumberBacking", (0.45, 0.05, 0.28), (0.0, 0.0, 0.0), "coral", rear_plate, rotation=(0.08, 0.0, 0.0), bevel_width=0.04)
    add_number_22("RearNumber22", (0.0, -0.09, 0.0), 0.68, rear_plate)

    peg_parts = [
        box("FootpegL", (0.2, 0.14, 0.045), (-0.42, -0.28, 0.68), "dark_metal", bike, bevel_width=0.012),
        box("FootpegR", (0.2, 0.14, 0.045), (0.42, -0.28, 0.68), "dark_metal", bike, bevel_width=0.012),
    ]
    join_as("Bike_Footpegs", peg_parts)

    empty("bike-seat-anchor", (0.0, -0.48, 1.47), bike, display_size=0.08)
    empty("bike-left-hand-anchor", (-0.53, 0.59, 1.73), bike, display_size=0.07)
    empty("bike-right-hand-anchor", (0.53, 0.59, 1.73), bike, display_size=0.07)
    empty("bike-left-boot-anchor", (-0.42, -0.28, 0.73), bike, display_size=0.07)
    empty("bike-right-boot-anchor", (0.42, -0.28, 0.73), bike, display_size=0.07)
    return bike


def add_arm(
    side: str,
    pivot_location: tuple[float, float, float],
    parent: bpy.types.Object,
) -> bpy.types.Object:
    left = side == "left"
    sign = -1.0 if left else 1.0
    pivot = empty(f"rider-{side}-arm-pivot", pivot_location, parent, display_size=0.1)
    arm_group = empty(f"Rider_{'Left' if left else 'Right'}Arm", (0.0, 0.0, 0.0), pivot, display_size=0.07)
    elbow = (sign * 0.12, 0.44, -0.08)
    hand = (sign * 0.18, 0.8, -0.26)
    parts = [
        frustum_between("UpperArm", (0.0, 0.0, 0.0), elbow, 0.098, 0.072, "coral", arm_group, vertices=14),
        frustum_between("Forearm", elbow, hand, 0.078, 0.055, "coral", arm_group, vertices=14),
        frustum_between("ShoulderCuff", (0.0, 0.0, 0.0), tuple(Vector(elbow) * 0.3), 0.122, 0.1, "navy", arm_group, vertices=12),
        box("ElbowGuard", (0.17, 0.145, 0.17), elbow, "navy", arm_group, rotation=(-0.18, 0.0, sign * 0.14), bevel_width=0.03),
        box("ElbowCreamCap", (0.12, 0.06, 0.09), (elbow[0] + sign * 0.035, elbow[1] + 0.035, elbow[2] + 0.01), "navy", arm_group, rotation=(-0.18, 0.0, sign * 0.14), bevel_width=0.014),
        box("ForearmTealCuff", (0.14, 0.08, 0.08), (sign * 0.17, 0.67, -0.22), "coral", arm_group, rotation=(-0.14, 0.0, sign * 0.08), bevel_width=0.018),
        add_side_decal(f"{side.title()}ForearmNavyFlash", LIGHTNING_FLASH_PROFILE, sign * 0.205, 0.61, -0.18, 0.13, "navy", arm_group, depth=0.012),
        add_side_decal(f"{side.title()}BicepCoralFlash", LIGHTNING_FLASH_PROFILE, sign * 0.165, 0.24, -0.04, 0.12, "coral", arm_group, depth=0.012),
        ico("GlovePalm", (0.18, 0.17, 0.15), hand, "navy", arm_group, subdivisions=2, smooth=True),
        box("GloveCuff", (0.17, 0.13, 0.085), (hand[0], hand[1] - 0.07, hand[2] + 0.04), "navy", arm_group, bevel_width=0.024),
        cylinder("GripWrap", 0.048, 0.15, hand, "navy", arm_group, vertices=12, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.007, smooth=True),
    ]
    joined = join_as(f"Rider_{'Left' if left else 'Right'}ArmGeometry", parts)
    joined["neutral_contact"] = "handlebar grip"
    return pivot


def add_leg(
    side: str,
    pivot_location: tuple[float, float, float],
    parent: bpy.types.Object,
) -> bpy.types.Object:
    left = side == "left"
    sign = -1.0 if left else 1.0
    pivot = empty(f"rider-{side}-leg-pivot", pivot_location, parent, display_size=0.11)
    leg_group = empty(f"Rider_{'Left' if left else 'Right'}Leg", (0.0, 0.0, 0.0), pivot, display_size=0.07)
    knee = (sign * 0.17, 0.45, -0.33)
    ankle = (sign * 0.21, 0.12, -0.6)
    parts = [
        frustum_between("Thigh", (0.0, 0.0, 0.0), knee, 0.122, 0.094, "teal", leg_group, vertices=14),
        frustum_between("Shin", knee, ankle, 0.098, 0.072, "teal", leg_group, vertices=14),
        frustum_between("HipCuff", (0.0, 0.0, 0.0), tuple(Vector(knee) * 0.27), 0.14, 0.12, "teal", leg_group, vertices=12),
        box("KneeGuard", (0.21, 0.155, 0.21), knee, "cream", leg_group, rotation=(-0.24, 0.0, sign * 0.12), bevel_width=0.034),
        box("KneeGuardDarkInset", (0.145, 0.05, 0.13), (knee[0] + sign * 0.02, knee[1] + 0.065, knee[2] + 0.008), "teal", leg_group, rotation=(-0.24, 0.0, sign * 0.12), bevel_width=0.011),
        box("ShinCreamSidePlate", (0.12, 0.07, 0.2), (sign * 0.245, 0.31, -0.5), "cream", leg_group, rotation=(-0.22, 0.0, sign * 0.1), bevel_width=0.018),
        add_side_decal(f"{side.title()}ThighCreamBolt", LIGHTNING_FLASH_PROFILE, sign * 0.235, 0.26, -0.21, 0.16, "cream", leg_group, depth=0.014),
        add_side_decal(f"{side.title()}ShinTealStar", FIVE_POINT_STAR_PROFILE, sign * 0.255, 0.22, -0.44, 0.105, "teal", leg_group, depth=0.012),
        frustum_between("BootShin", (ankle[0], ankle[1] - 0.03, ankle[2] + 0.15), (ankle[0], ankle[1], ankle[2] - 0.1), 0.098, 0.085, "cream", leg_group, vertices=12),
    ]
    boot = side_prism(
        "BootFoot",
        ankle[0],
        0.2,
        ((ankle[1] - 0.03, ankle[2] - 0.06), (ankle[1] + 0.07, ankle[2] - 0.22), (ankle[1] + 0.35, ankle[2] - 0.23), (ankle[1] + 0.43, ankle[2] - 0.16), (ankle[1] + 0.3, ankle[2] - 0.08), (ankle[1] + 0.08, ankle[2] + 0.02)),
        "cream",
        leg_group,
        bevel_width=0.026,
    )
    parts.extend([
        boot,
        box("BootSole", (0.23, 0.47, 0.055), (ankle[0], ankle[1] + 0.2, ankle[2] - 0.245), "teal", leg_group, bevel_width=0.014),
        box("BootHeel", (0.2, 0.12, 0.13), (ankle[0], ankle[1] + 0.015, ankle[2] - 0.16), "teal", leg_group, bevel_width=0.024),
        box("BootBuckleUpper", (0.23, 0.04, 0.055), (ankle[0], ankle[1] + 0.09, ankle[2] + 0.07), "teal", leg_group, bevel_width=0.012),
        box("BootBuckleLower", (0.23, 0.04, 0.05), (ankle[0], ankle[1] + 0.14, ankle[2] - 0.04), "teal", leg_group, bevel_width=0.011),
    ])
    joined = join_as(f"Rider_{'Left' if left else 'Right'}LegGeometry", parts)
    joined["neutral_contact"] = "footpeg"
    return pivot


def add_rider(root: bpy.types.Object) -> bpy.types.Object:
    rider = empty("player-rider", (0.0, 0.0, 0.0), root, display_size=0.3)
    rider["pose_pivot_count"] = 6
    hips_parts = [
        ring_shell("RiderPelvisCore", ((-0.15, 0.04, 0.32, 0.24), (-0.02, 0.06, 0.44, 0.3), (0.14, 0.095, 0.43, 0.27), (0.19, 0.1, 0.31, 0.2)), (0.0, -0.43, 1.45), "charcoal", rider, segments=14),
        box("RiderHipBand", (0.44, 0.2, 0.075), (0.0, -0.34, 1.61), "charcoal", rider, bevel_width=0.022),
        box("RiderBeltBuckle", (0.16, 0.045, 0.08), (0.0, -0.22, 1.61), "charcoal", rider, bevel_width=0.012),
        ico("RiderHipPanelL", (0.22, 0.26, 0.23), (-0.195, -0.31, 1.49), "charcoal", rider, rotation=(-0.12, 0.0, -0.08), subdivisions=2, smooth=True),
        ico("RiderHipPanelR", (0.22, 0.26, 0.23), (0.195, -0.31, 1.49), "charcoal", rider, rotation=(-0.12, 0.0, 0.08), subdivisions=2, smooth=True),
    ]
    join_as("Rider_Hips", hips_parts)

    torso = empty("rider-torso-pivot", (0.0, -0.4, 1.56), rider, display_size=0.12)
    torso_parts = [
        ring_shell("TorsoFabric", ((0.0, 0.1, 0.39, 0.23), (0.18, 0.19, 0.44, 0.27), (0.39, 0.34, 0.52, 0.3), (0.53, 0.48, 0.56, 0.28), (0.58, 0.52, 0.41, 0.21)), (0.0, 0.0, 0.0), "coral", torso, segments=16),
        side_prism("TorsoCoralSideL", -0.25, 0.075, ((0.08, 0.05), (0.22, 0.43), (0.39, 0.54), (0.46, 0.42), (0.27, 0.13)), "coral", torso, bevel_width=0.019),
        side_prism("TorsoCoralSideR", 0.25, 0.075, ((0.08, 0.05), (0.22, 0.43), (0.39, 0.54), (0.46, 0.42), (0.27, 0.13)), "coral", torso, bevel_width=0.019),
        side_prism("TorsoNavyRibL", -0.285, 0.042, ((0.05, 0.08), (0.17, 0.43), (0.29, 0.51), (0.32, 0.42), (0.2, 0.14)), "navy", torso, bevel_width=0.012),
        side_prism("TorsoNavyRibR", 0.285, 0.042, ((0.05, 0.08), (0.17, 0.43), (0.29, 0.51), (0.32, 0.42), (0.2, 0.14)), "navy", torso, bevel_width=0.012),
        side_prism("TorsoCoralWaist", 0.0, 0.34, ((0.04, 0.02), (0.13, 0.18), (0.2, 0.2), (0.13, 0.04)), "coral", torso, bevel_width=0.018),
        box("TorsoCoralYoke", (0.51, 0.15, 0.1), (0.0, 0.48, 0.48), "coral", torso, rotation=(-0.28, 0.0, 0.0), bevel_width=0.028),
        box("TorsoCenterZip", (0.052, 0.045, 0.39), (0.0, 0.535, 0.28), "navy", torso, rotation=(-0.22, 0.0, 0.0), bevel_width=0.009),
        box("TorsoCreamNameTab", (0.18, 0.04, 0.065), (0.0, 0.56, 0.5), "number_cream", torso, rotation=(-0.24, 0.0, 0.0), bevel_width=0.01),
    ]
    join_as("Rider_Torso", torso_parts)
    chest_parts = [
        extruded_polygon("ChestArmorCore", ((-0.21, -0.18), (0.21, -0.18), (0.235, 0.12), (0.16, 0.24), (0.0, 0.28), (-0.16, 0.24), (-0.235, 0.12)), (0.0, 0.55, 0.32), 1.0, 0.075, (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0), "navy", torso),
        extruded_polygon("ChestArmorInset", ((-0.105, -0.11), (0.105, -0.11), (0.13, 0.08), (0.0, 0.16), (-0.13, 0.08)), (0.0, 0.61, 0.33), 1.0, 0.03, (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0), "coral", torso),
        box("ChestArmorRivet", (0.12, 0.035, 0.11), (0.0, 0.65, 0.32), "coral", torso, rotation=(-0.18, 0.0, math.pi / 4), bevel_width=0.018),
        box("ChestArmorCreamLatchL", (0.09, 0.033, 0.055), (-0.13, 0.66, 0.16), "number_cream", torso, rotation=(-0.18, 0.0, -0.08), bevel_width=0.01),
        box("ChestArmorCreamLatchR", (0.09, 0.033, 0.055), (0.13, 0.66, 0.16), "number_cream", torso, rotation=(-0.18, 0.0, 0.08), bevel_width=0.01),
        ico("ShoulderArmorL", (0.27, 0.24, 0.2), (-0.31, 0.39, 0.46), "navy", torso, subdivisions=2, smooth=True),
        ico("ShoulderArmorR", (0.27, 0.24, 0.2), (0.31, 0.39, 0.46), "navy", torso, subdivisions=2, smooth=True),
    ]
    join_as("Rider_ChestArmor", chest_parts)

    back_plate = empty("Rider_BackPlate", (0.0, 0.0, 0.29), torso, display_size=0.08)
    back_plate.rotation_euler.x = -0.5
    back_parts = [
        extruded_polygon("BackPlateUpper", ((-0.22, 0.23), (-0.16, 0.3), (0.16, 0.3), (0.22, 0.23), (0.195, -0.17), (0.105, -0.28), (-0.105, -0.28), (-0.195, -0.17)), (0.0, -0.04, 0.02), 1.0, 0.068, (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0), "navy", back_plate),
        box("BackPlateMiddle", (0.37, 0.068, 0.13), (0.0, -0.05, -0.02), "navy", back_plate, bevel_width=0.027),
        box("BackPlateLower", (0.31, 0.068, 0.11), (0.0, -0.04, -0.17), "navy", back_plate, bevel_width=0.025),
        box("BackPlateCreamShoulderStripeL", (0.12, 0.032, 0.045), (-0.18, -0.075, 0.17), "number_cream", back_plate, rotation=(0.0, 0.0, -0.22), bevel_width=0.008),
        box("BackPlateCreamShoulderStripeR", (0.12, 0.032, 0.045), (0.18, -0.075, 0.17), "number_cream", back_plate, rotation=(0.0, 0.0, 0.22), bevel_width=0.008),
    ]
    join_as("Rider_BackPlateShell", back_parts)
    add_number_22("JerseyNumber22", (0.0, -0.09, 0.03), 0.76, back_plate)

    head = empty("rider-head-pivot", (0.0, 0.48, 0.55), torso, display_size=0.1)
    empty("Rider_Head", (0.0, 0.02, 0.07), head, display_size=0.06)
    helmet_parts = [
        ring_shell("HelmetShell", ((-0.12, 0.015, 0.24, 0.2), (-0.04, 0.045, 0.34, 0.34), (0.12, 0.06, 0.42, 0.44), (0.28, 0.045, 0.39, 0.4), (0.38, 0.02, 0.25, 0.25), (0.43, 0.0, 0.06, 0.08)), (0.0, 0.015, 0.04), "coral", head, segments=16),
        cylinder("HelmetNeckGuard", 0.125, 0.17, (0.0, 0.0, -0.13), "teal", head, vertices=14, bevel_width=0.016, smooth=True),
        side_prism("HelmetCrownStripe", 0.0, 0.1, ((-0.14, 0.25), (0.01, 0.45), (0.21, 0.38), (0.27, 0.19), (-0.06, 0.16)), "teal", head, bevel_width=0.017),
        side_prism("HelmetCoralRearBand", 0.0, 0.11, ((-0.14, 0.09), (-0.03, 0.31), (0.12, 0.31), (0.19, 0.16), (0.1, 0.06)), "coral", head, bevel_width=0.014),
        side_prism("HelmetTealRearSlashL", -0.145, 0.055, ((0.0, 0.25), (0.16, 0.36), (0.28, 0.21), (0.19, 0.09)), "teal", head, bevel_width=0.012),
        side_prism("HelmetTealRearSlashR", 0.145, 0.055, ((0.0, 0.25), (0.16, 0.36), (0.28, 0.21), (0.19, 0.09)), "teal", head, bevel_width=0.012),
        side_prism("HelmetCheekL", -0.165, 0.07, ((0.06, 0.22), (0.2, 0.23), (0.37, 0.04), (0.36, -0.08), (0.14, -0.13), (0.01, -0.04)), "teal", head, bevel_width=0.018),
        side_prism("HelmetCheekR", 0.165, 0.07, ((0.06, 0.22), (0.2, 0.23), (0.37, 0.04), (0.36, -0.08), (0.14, -0.13), (0.01, -0.04)), "teal", head, bevel_width=0.018),
        tapered_box("HelmetChinGuard", (0.27, 0.11), (0.34, 0.145), 0.32, (0.0, 0.32, -0.07), "coral", head, bevel_width=0.03),
        box("HelmetGoggleBrow", (0.43, 0.048, 0.058), (0.0, 0.43, 0.255), "teal", head, rotation=(-0.04, 0.0, 0.0), bevel_width=0.013),
        box("HelmetGoggleLowerRail", (0.36, 0.04, 0.038), (0.0, 0.444, 0.095), "teal", head, rotation=(-0.08, 0.0, 0.0), bevel_width=0.011),
        box("HelmetGoggleSideL", (0.045, 0.04, 0.15), (-0.215, 0.43, 0.17), "teal", head, rotation=(-0.05, 0.0, -0.08), bevel_width=0.011),
        box("HelmetGoggleSideR", (0.045, 0.04, 0.15), (0.215, 0.43, 0.17), "teal", head, rotation=(-0.05, 0.0, 0.08), bevel_width=0.011),
        box("HelmetJawInset", (0.22, 0.045, 0.088), (0.0, 0.475, -0.06), "teal", head, rotation=(-0.08, 0.0, 0.0), bevel_width=0.017),
        box("HelmetChinVent", (0.18, 0.038, 0.064), (0.0, 0.502, -0.07), "visor", head, rotation=(-0.08, 0.0, 0.0), bevel_width=0.014),
        box("HelmetChinVentSlotL", (0.052, 0.026, 0.04), (-0.07, 0.522, -0.067), "visor", head, rotation=(-0.08, 0.0, 0.0), bevel_width=0.006),
        box("HelmetChinVentSlotR", (0.052, 0.026, 0.04), (0.07, 0.522, -0.067), "visor", head, rotation=(-0.08, 0.0, 0.0), bevel_width=0.006),
        box("HelmetRearSpine", (0.075, 0.035, 0.27), (0.0, -0.19, 0.17), "teal", head, rotation=(0.03, 0.0, 0.0), bevel_width=0.019),
        box("HelmetRearRidgeL", (0.12, 0.034, 0.05), (-0.115, -0.185, 0.29), "teal", head, rotation=(0.0, -0.35, 0.0), bevel_width=0.015),
        box("HelmetRearRidgeR", (0.12, 0.034, 0.05), (0.115, -0.185, 0.29), "teal", head, rotation=(0.0, 0.35, 0.0), bevel_width=0.015),
    ]
    join_as("Rider_Helmet", helmet_parts)
    extruded_polygon("Rider_Visor", ((-0.19, 0.08), (0.19, 0.08), (0.175, -0.05), (0.09, -0.095), (-0.09, -0.095), (-0.175, -0.05)), (0.0, 0.4, 0.18), 1.0, 0.045, (1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0), "visor", head)
    peak = tapered_box("Rider_HelmetPeak", (0.35, 0.028), (0.25, 0.058), 0.38, (0.0, 0.28, 0.37), "coral", head, bevel_width=0.019)
    peak.rotation_euler.x = -0.16
    apply_mesh_transform(peak)

    add_arm("left", (-0.35, 0.19, 0.43), torso)
    add_arm("right", (0.35, 0.19, 0.43), torso)
    add_leg("left", (-0.21, -0.4, 1.52), rider)
    add_leg("right", (0.21, -0.4, 1.52), rider)
    return rider


def replace_public_meshes_with_markers() -> None:
    """Keep public nodes stable while moving render geometry into draw buckets."""
    for name in PUBLIC_NODE_NAMES:
        source = bpy.data.objects.get(name)
        if source is None or source.type != "MESH":
            continue
        parent = source.parent
        local_matrix = source.matrix_local.copy()
        properties = {key: source[key] for key in source.keys()}
        source.name = f"{name}_SourceGeometry"
        marker = empty(name, (0.0, 0.0, 0.0), parent, display_size=0.07)
        marker.matrix_local = local_matrix
        for key, value in properties.items():
            marker[key] = value
        for child in tuple(source.children):
            world_matrix = child.matrix_world.copy()
            child.parent = marker
            child.matrix_world = world_matrix


def consolidate_region_by_material(
    parent: bpy.types.Object,
    prefix: str,
    *,
    stop_at: tuple[bpy.types.Object, ...] = (),
) -> None:
    """Bake a rigid region into one render mesh per material and pivot boundary."""
    stops = set(stop_at)
    sources: list[bpy.types.Object] = []

    def collect(node: bpy.types.Object) -> None:
        for child in node.children:
            if child in stops:
                continue
            if child.type == "MESH":
                sources.append(child)
            collect(child)

    collect(parent)
    if not sources:
        return

    parent_inverse = parent.matrix_world.inverted()
    buckets: dict[str, dict[str, object]] = {}
    vertex_maps: dict[tuple[str, int], dict[int, int]] = {}
    for source in sources:
        transform = parent_inverse @ source.matrix_world
        source_key = source.as_pointer()
        for polygon in source.data.polygons:
            material = source.data.materials[polygon.material_index]
            if material is None:
                raise ValueError(f"{source.name} has an unassigned material slot")
            bucket = buckets.setdefault(material.name, {
                "material": material,
                "vertices": [],
                "faces": [],
                "smooth": [],
            })
            vertex_map = vertex_maps.setdefault((material.name, source_key), {})
            face: list[int] = []
            for source_index in polygon.vertices:
                if source_index not in vertex_map:
                    coordinate = transform @ source.data.vertices[source_index].co
                    vertex_map[source_index] = len(bucket["vertices"])
                    bucket["vertices"].append(tuple(coordinate))
                face.append(vertex_map[source_index])
            bucket["faces"].append(tuple(face))
            bucket["smooth"].append(polygon.use_smooth)

    for source in sources:
        bpy.data.objects.remove(source, do_unlink=True)

    for material_name in sorted(buckets):
        bucket = buckets[material_name]
        object_name = stable_name(f"{prefix}_{material_name.removeprefix('RRR_')}")
        mesh = bpy.data.meshes.new(f"{object_name}_Mesh")
        mesh.from_pydata(bucket["vertices"], [], bucket["faces"])
        mesh.materials.append(bucket["material"])
        mesh.update()
        for polygon, smooth in zip(mesh.polygons, bucket["smooth"], strict=True):
            polygon.use_smooth = smooth
        obj = bpy.data.objects.new(object_name, mesh)
        ASSET_COLLECTION.objects.link(obj)
        parent_to(obj, parent)
        obj["consolidated_region"] = prefix


def consolidate_render_geometry() -> None:
    replace_public_meshes_with_markers()
    bike = bpy.data.objects["RRR_BikeVisual"]
    steering = bpy.data.objects["bike-steering-pivot"]
    front_suspension = bpy.data.objects["bike-front-suspension-pivot"]
    rear_suspension = bpy.data.objects["bike-rear-suspension-pivot"]
    front_wheel = bpy.data.objects["FrontTire"]
    rear_wheel = bpy.data.objects["RearTire"]
    rider = bpy.data.objects["player-rider"]
    torso = bpy.data.objects["rider-torso-pivot"]
    head = bpy.data.objects["rider-head-pivot"]
    left_arm = bpy.data.objects["rider-left-arm-pivot"]
    right_arm = bpy.data.objects["rider-right-arm-pivot"]
    left_leg = bpy.data.objects["rider-left-leg-pivot"]
    right_leg = bpy.data.objects["rider-right-leg-pivot"]

    consolidate_region_by_material(
        bike,
        "BikeStatic",
        stop_at=(steering, rear_suspension),
    )
    consolidate_region_by_material(
        steering,
        "BikeSteering",
        stop_at=(front_suspension,),
    )
    consolidate_region_by_material(front_wheel, "FrontWheel")
    consolidate_region_by_material(
        rear_suspension,
        "RearSuspension",
        stop_at=(rear_wheel,),
    )
    consolidate_region_by_material(rear_wheel, "RearWheel")
    consolidate_region_by_material(
        rider,
        "RiderHips",
        stop_at=(torso, left_leg, right_leg),
    )
    consolidate_region_by_material(
        torso,
        "RiderTorso",
        stop_at=(head, left_arm, right_arm),
    )
    consolidate_region_by_material(head, "RiderHead")
    consolidate_region_by_material(left_arm, "RiderLeftArm")
    consolidate_region_by_material(right_arm, "RiderRightArm")
    consolidate_region_by_material(left_leg, "RiderLeftLeg")
    consolidate_region_by_material(right_leg, "RiderRightLeg")


def build_scene() -> bpy.types.Object:
    global ASSET_COLLECTION
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "RRR_HeroBikeRiderScene"
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.world = bpy.data.worlds.new("RRR Hero Source World")
    scene.world.color = (0.04, 0.04, 0.04)
    NAME_COUNTS.clear()
    ASSET_COLLECTION = bpy.data.collections.new("Hero Bike and Rider — Runtime Root")
    scene.collection.children.link(ASSET_COLLECTION)
    create_materials()

    asset = empty(ROOT_NAME, (0.0, 0.0, 0.0), display_size=0.4)
    asset["asset_root"] = True
    asset["asset_source"] = "Original project-authored Blender-native geometry"
    asset["authoring_script_sha256"] = AUTHORING_SCRIPT_SHA256
    asset["authoring_blender_version"] = bpy.app.version_string
    asset["source_schema"] = "rrr-hero-bike-rider-v1"
    asset["source_pair_id"] = str(uuid.uuid4())
    asset["reference"] = "docs/design/concepts/hero-bike-rider-production-reference.png"
    asset["contract"] = "docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md"
    asset["units"] = "meters"
    asset["forward_axis"] = "+Y"
    asset["up_axis"] = "+Z"
    asset["gameplay_authority"] = "presentation-only"
    add_bike(asset)
    add_rider(asset)
    consolidate_render_geometry()

    names = [obj.name for obj in bpy.data.objects]
    assert len(names) == len(set(names)), "Every exported node name must be unique"
    for name in PUBLIC_NODE_NAMES:
        assert name in names, f"Missing required node {name}"
    mesh_count = sum(1 for obj in descendants(asset) if obj.type == "MESH")
    primitive_count = sum(len(obj.data.materials) for obj in descendants(asset) if obj.type == "MESH")
    assert mesh_count <= 28, f"Hero source has {mesh_count} mesh nodes; maximum is 28"
    assert primitive_count <= 28, f"Hero source has {primitive_count} material primitives; maximum is 28"
    return asset


def descendants(obj: bpy.types.Object) -> list[bpy.types.Object]:
    result = [obj]
    for child in obj.children:
        result.extend(descendants(child))
    return result


def save_and_export(output_dir: Path, asset: bpy.types.Object) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    blend_path = (output_dir / "hero-bike-rider-source.blend").resolve()
    glb_path = (output_dir / "hero-bike-rider-raw.glb").resolve()
    bpy.context.preferences.filepaths.save_version = 0
    sanitize_saved_workspace_metadata()
    bpy.ops.wm.save_as_mainfile(
        filepath=str(blend_path),
        check_existing=False,
        compress=False,
    )

    bpy.ops.object.select_all(action="DESELECT")
    selected = descendants(asset)
    for obj in selected:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = asset
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


def compose_preview_contact_sheet(
    panel_paths: tuple[Path, Path, Path, Path],
    output_path: Path,
) -> Path:
    """Combine four fixed-size Blender renders without an external image tool."""
    panel_width = 640
    panel_height = 450
    sheet_width = panel_width * 2
    sheet_height = panel_height * 2
    sheet_pixels = array("f", [0.0]) * (sheet_width * sheet_height * 4)

    for index, panel_path in enumerate(panel_paths):
        panel = bpy.data.images.load(str(panel_path), check_existing=False)
        if tuple(panel.size) != (panel_width, panel_height):
            raise ValueError(f"Unexpected preview panel size for {panel_path}: {tuple(panel.size)}")
        panel_pixels = array("f", panel.pixels[:])
        column = index % 2
        row_from_top = index // 2
        destination_y = (1 - row_from_top) * panel_height
        row_values = panel_width * 4
        for row in range(panel_height):
            source_start = row * row_values
            destination_start = (
                (destination_y + row) * sheet_width + column * panel_width
            ) * 4
            sheet_pixels[destination_start : destination_start + row_values] = (
                panel_pixels[source_start : source_start + row_values]
            )

    contact_sheet = bpy.data.images.new(
        "HeroBikeRiderPreviewContactSheet",
        width=sheet_width,
        height=sheet_height,
        alpha=True,
        float_buffer=False,
    )
    contact_sheet.colorspace_settings.name = "sRGB"
    contact_sheet.pixels.foreach_set(sheet_pixels)
    contact_sheet.update()
    contact_sheet.filepath_raw = str(output_path)
    contact_sheet.file_format = "PNG"
    contact_sheet.save()
    return output_path


def render_preview(output_dir: Path) -> tuple[Path, ...]:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"

    preview_collection = bpy.data.collections.new("Source Preview — Not Exported")
    scene.collection.children.link(preview_collection)
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0.0, 0.0, -0.015))
    ground = bpy.context.object
    ground.name = "PreviewGround"
    for collection in tuple(ground.users_collection):
        collection.objects.unlink(ground)
    preview_collection.objects.link(ground)
    ground_material = bpy.data.materials.new("PreviewGroundMaterial")
    ground_material.diffuse_color = (0.16, 0.145, 0.13, 1.0)
    ground.data.materials.append(ground_material)

    def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
        direction = Vector(target) - obj.location
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    camera_data = bpy.data.cameras.new("PreviewCameraData")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    preview_collection.objects.link(camera)
    camera_data.lens = 58
    scene.camera = camera

    light_specs = (
        ("PreviewKey", (4.5, -4.0, 6.2), 1200.0, 5.0),
        ("PreviewFill", (-4.0, -1.0, 3.6), 780.0, 4.0),
        ("PreviewRim", (1.0, 4.2, 5.5), 1050.0, 3.5),
    )
    for name, location, energy, size in light_specs:
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        light.location = location
        preview_collection.objects.link(light)
        look_at(light, (0.0, 0.0, 1.1))

    preview_path = (output_dir / "hero-bike-rider-preview.png").resolve()
    camera.location = (5.2, -5.9, 3.05)
    look_at(camera, (0.0, -0.12, 1.25))
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 900
    scene.render.filepath = str(preview_path)
    bpy.ops.render.render(write_still=True)

    panel_specs = (
        ("rear-right", (5.2, -5.9, 3.05), (0.0, -0.12, 1.25)),
        ("right-profile", (6.4, 0.0, 2.35), (0.0, -0.08, 1.25)),
        ("left-profile", (-6.4, 0.0, 2.35), (0.0, -0.08, 1.25)),
        ("front-left", (-4.9, 5.4, 2.85), (0.0, 0.08, 1.2)),
    )
    scene.render.resolution_x = 640
    scene.render.resolution_y = 450
    panel_paths: list[Path] = []
    for label, location, target in panel_specs:
        camera.location = location
        look_at(camera, target)
        panel_path = (output_dir / f"hero-bike-rider-preview-{label}.png").resolve()
        scene.render.filepath = str(panel_path)
        bpy.ops.render.render(write_still=True)
        panel_paths.append(panel_path)

    contact_sheet_path = (
        output_dir / "hero-bike-rider-preview-contact-sheet.png"
    ).resolve()
    compose_preview_contact_sheet(tuple(panel_paths), contact_sheet_path)
    return (preview_path, *panel_paths, contact_sheet_path)


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser()
    if not output_dir.is_absolute():
        output_dir = Path.cwd() / output_dir
    asset = build_scene()
    node_count = len(descendants(asset))
    mesh_count = sum(1 for obj in bpy.data.objects if obj.type == "MESH")
    triangle_count = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        triangle_count += len(obj.data.loop_triangles)
    material_count = len(bpy.data.materials)
    blend_path, glb_path = save_and_export(output_dir, asset)
    preview_paths = render_preview(output_dir)
    print(f"Hero root: {asset.name}")
    print(f"Hero nodes: {node_count}")
    print(f"Hero mesh objects: {mesh_count}")
    print(f"Hero materials: {material_count}")
    print(f"Hero triangles: {triangle_count}")
    print(f"Saved Blender source: {blend_path}")
    print(f"Exported raw GLB: {glb_path}")
    for preview_path in preview_paths:
        print(f"Rendered source preview: {preview_path}")


if __name__ == "__main__":
    main()
