"""Build the original shared RIVET RIDGE RALLY rival bike-and-rider base.

Blender 4.5 LTS, headless-compatible. The exported GLB contains one lower-detail
presentation rig. Runtime code clones its geometry for the five Rival/Mastery
entrants, then applies project-authored palette and number variants.
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


ROOT_NAME = "RRR_RivalPackBase"
SCENE_NAME = "RRR_RivalPackScene"
VARIANTS = (
    ("17", (0.89, 0.43, 0.04, 1.0), (0.018, 0.055, 0.10, 1.0)),
    ("31", (0.085, 0.19, 0.62, 1.0), (0.89, 0.43, 0.04, 1.0)),
    ("46", (0.34, 0.095, 0.56, 1.0), (0.91, 0.84, 0.70, 1.0)),
    ("58", (0.045, 0.39, 0.105, 1.0), (0.93, 0.61, 0.025, 1.0)),
    ("73", (0.80, 0.21, 0.045, 1.0), (0.007, 0.33, 0.32, 1.0)),
)
BASE_PRIMARY = VARIANTS[0][1]
BASE_ACCENT = VARIANTS[0][2]
CREAM = (0.98, 0.9, 0.7, 1.0)
PALETTE = {
    "primary": BASE_PRIMARY,
    "accent": BASE_ACCENT,
    "hardware": (0.17, 0.21, 0.24, 1.0),
    "wheel": (0.025, 0.03, 0.035, 1.0),
    "number_field": (1.0, 1.0, 1.0, 1.0),
}
MATERIAL_SPECS = {
    "primary": ("RRR_RivalPrimary", 0.55, 0.0),
    "accent": ("RRR_RivalAccent", 0.57, 0.0),
    "hardware": ("RRR_RivalHardware", 0.4, 0.62),
    "wheel": ("RRR_RivalWheel", 0.84, 0.12),
    "number_field": ("RRR_RivalNumberField", 0.66, 0.0),
}
REQUIRED_NODE_NAMES = (
    ROOT_NAME,
    "RRR_RivalBikeVisual",
    "BikeStatic_Primary",
    "BikeStatic_Accent",
    "BikeStatic_Hardware",
    "BikeStatic_NumberField",
    "bike-steering-pivot",
    "bike-front-suspension-pivot",
    "FrontTire",
    "FrontWheel_Wheel",
    "bike-rear-suspension-pivot",
    "RearTire",
    "RearWheel_Wheel",
    "rival-rider",
    "rider-torso-pivot",
    "RivalTorso_Primary",
    "rider-head-pivot",
    "RivalHead_Accent",
    "rider-left-arm-pivot",
    "RivalLeftArm_Accent",
    "rider-right-arm-pivot",
    "RivalRightArm_Accent",
    "rider-left-leg-pivot",
    "RivalLeftLeg_Primary",
    "rider-right-leg-pivot",
    "RivalRightLeg_Primary",
)

MATERIALS: dict[str, bpy.types.Material] = {}
NAME_COUNTS: dict[str, int] = {}
ASSET_COLLECTION: bpy.types.Collection
NUMBER_IMAGE: bpy.types.Image
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
    parser = argparse.ArgumentParser(description="Build the shared rival pack base")
    parser.add_argument(
        "--output-dir",
        default="art-source/blender/rival-pack/generated",
        help="Directory for canonical source, raw GLB, and source previews",
    )
    return parser.parse_args(values)


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
    display_size: float = 0.14,
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
    bevel_width: float = 0.02,
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
    bevel_width: float = 0.012,
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
    bevel_width: float = 0.016,
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
    subdivisions: int = 2,
    smooth: bool = False,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=subdivisions,
        radius=1.0,
        location=location,
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
    major_segments: int = 18,
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
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    ASSET_COLLECTION.objects.link(obj)
    assign_material(obj, key)
    bevel(obj, bevel_width)
    return parent_to(obj, parent)


def side_prism(
    name: str,
    x_center: float,
    thickness: float,
    profile: tuple[tuple[float, float], ...],
    key: str,
    parent: bpy.types.Object,
    *,
    bevel_width: float = 0.016,
) -> bpy.types.Object:
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
    bevel_width: float = 0.02,
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
    vertices: int = 8,
    bevel_width: float = 0.007,
) -> bpy.types.Object:
    a = Vector(start)
    b = Vector(end)
    delta = b - a
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=delta.length,
        location=tuple((a + b) * 0.5),
    )
    obj = bpy.context.object
    obj.name = stable_name(name)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(delta.normalized())
    finish_mesh(obj, key, bevel_width)
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


SEGMENTS_BY_DIGIT = {
    "0": "ab cdef".replace(" ", ""),
    "1": "bc",
    "2": "abdeg",
    "3": "abcdg",
    "4": "bcfg",
    "5": "acdfg",
    "6": "acdefg",
    "7": "abc",
    "8": "abcdefg",
    "9": "abcdfg",
}
SEGMENT_RECTS = {
    "a": (7, 4, 23, 7),
    "b": (26, 8, 30, 25),
    "c": (26, 34, 30, 51),
    "d": (7, 50, 23, 53),
    "e": (3, 34, 7, 51),
    "f": (3, 8, 7, 25),
    "g": (7, 27, 23, 31),
}


def number_pixels(
    number: str,
    primary: tuple[float, float, float, float],
    accent: tuple[float, float, float, float],
    width: int = 128,
    height: int = 64,
) -> array:
    pixels = array("f", primary) * (width * height)

    def fill_rect(
        left: int,
        top: int,
        right: int,
        bottom: int,
        color: tuple[float, float, float, float],
    ) -> None:
        for image_y in range(top, bottom + 1):
            blender_y = height - 1 - image_y
            for image_x in range(left, right + 1):
                offset = (blender_y * width + image_x) * 4
                pixels[offset : offset + 4] = array("f", color)

    fill_rect(0, 0, width - 1, 3, accent)
    fill_rect(0, height - 4, width - 1, height - 1, accent)
    fill_rect(0, 0, 3, height - 1, accent)
    fill_rect(width - 4, 0, width - 1, height - 1, accent)
    for digit_index, digit in enumerate(number):
        x_offset = 31 + digit_index * 36
        for segment in SEGMENTS_BY_DIGIT[digit]:
            left, top, right, bottom = SEGMENT_RECTS[segment]
            fill_rect(
                x_offset + left,
                top + 3,
                x_offset + right,
                bottom + 3,
                CREAM,
            )
    return pixels


def update_number_image(
    number: str,
    primary: tuple[float, float, float, float],
    accent: tuple[float, float, float, float],
) -> None:
    NUMBER_IMAGE.pixels.foreach_set(number_pixels(number, primary, accent))
    NUMBER_IMAGE.update()


def create_materials() -> None:
    global NUMBER_IMAGE
    MATERIALS.clear()
    NUMBER_IMAGE = bpy.data.images.new(
        "RRR_RivalBaseNumber17",
        width=128,
        height=64,
        alpha=False,
        float_buffer=False,
    )
    NUMBER_IMAGE.colorspace_settings.name = "sRGB"
    update_number_image("17", BASE_PRIMARY, BASE_ACCENT)
    NUMBER_IMAGE.file_format = "PNG"

    for key, color in PALETTE.items():
        material_name, roughness, metallic = MATERIAL_SPECS[key]
        material = bpy.data.materials.new(material_name)
        material.diffuse_color = color
        material.use_nodes = True
        material.use_backface_culling = True
        node = material.node_tree.nodes.get("Principled BSDF")
        if node is not None:
            node.inputs["Base Color"].default_value = color
            node.inputs["Roughness"].default_value = roughness
            node.inputs["Metallic"].default_value = metallic
        if key == "number_field" and node is not None:
            texture_node = material.node_tree.nodes.new("ShaderNodeTexImage")
            texture_node.name = "Project-authored seven-segment number field"
            texture_node.image = NUMBER_IMAGE
            material.node_tree.links.new(texture_node.outputs["Color"], node.inputs["Base Color"])
        MATERIALS[key] = material


def create_number_field(parent: bpy.types.Object) -> bpy.types.Object:
    x = 0.376
    y_front = -0.49
    y_rear = -0.91
    z_bottom = 1.12
    z_top = 1.34
    vertices = [
        (x, y_rear, z_bottom),
        (x, y_front, z_bottom),
        (x, y_front, z_top),
        (x, y_rear, z_top),
        (-x, y_front, z_bottom),
        (-x, y_rear, z_bottom),
        (-x, y_rear, z_top),
        (-x, y_front, z_top),
    ]
    faces = [(0, 1, 2, 3), (4, 5, 6, 7)]
    obj = mesh_object(
        "BikeStatic_NumberField",
        vertices,
        faces,
        "number_field",
        parent,
    )
    uv_layer = obj.data.uv_layers.new(name="RivalNumberUV")
    uv_by_vertex = {
        0: (0.0, 0.0), 1: (1.0, 0.0), 2: (1.0, 1.0), 3: (0.0, 1.0),
        4: (0.0, 0.0), 5: (1.0, 0.0), 6: (1.0, 1.0), 7: (0.0, 1.0),
    }
    for polygon in obj.data.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = obj.data.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = uv_by_vertex[vertex_index]
    return obj


def add_wheel(
    name: str,
    location: tuple[float, float, float],
    parent: bpy.types.Object,
) -> bpy.types.Object:
    wheel = empty(name, location, parent, display_size=0.2)
    wheel["animated_axis"] = "+X"
    wheel["outer_radius_m"] = 0.62
    parts: list[bpy.types.Object] = [
        torus(f"{name}Tire", 0.475, 0.105, (0.0, 0.0, 0.0), "wheel", wheel, rotation=(0.0, math.pi / 2, 0.0)),
        torus(f"{name}Rim", 0.34, 0.026, (0.0, 0.0, 0.0), "wheel", wheel, major_segments=18, minor_segments=6, rotation=(0.0, math.pi / 2, 0.0)),
        cylinder(f"{name}Hub", 0.105, 0.27, (0.0, 0.0, 0.0), "wheel", wheel, vertices=12, rotation=(0.0, math.pi / 2, 0.0)),
        cylinder(f"{name}BrakeDisc", 0.225, 0.025, (0.14, 0.0, 0.0), "wheel", wheel, vertices=16, rotation=(0.0, math.pi / 2, 0.0), bevel_width=0.004),
    ]
    tread_count = 15
    for index in range(tread_count):
        angle = (index / tread_count) * math.tau
        parts.append(box(
            f"{name}TreadCenter",
            (0.15, 0.12, 0.085),
            (0.0, math.sin(angle) * 0.585, math.cos(angle) * 0.585),
            "wheel",
            wheel,
            rotation=(angle, 0.0, 0.0),
            bevel_width=0.01,
        ))
        shoulder_angle = angle + math.pi / tread_count
        for side_x, yaw in ((-0.14, -0.15), (0.14, 0.15)):
            parts.append(box(
                f"{name}TreadShoulder",
                (0.115, 0.105, 0.07),
                (
                    side_x,
                    math.sin(shoulder_angle) * 0.575,
                    math.cos(shoulder_angle) * 0.575,
                ),
                "wheel",
                wheel,
                rotation=(shoulder_angle, 0.0, yaw),
                bevel_width=0.009,
            ))
    for side_x in (-0.07, 0.07):
        for index in range(8):
            angle = (index / 8) * math.tau + (0.16 if side_x > 0 else 0.0)
            parts.append(cylinder_between(
                f"{name}Spoke",
                (side_x, 0.0, 0.0),
                (-side_x * 0.18, math.sin(angle) * 0.335, math.cos(angle) * 0.335),
                0.009,
                "wheel",
                wheel,
                vertices=6,
                bevel_width=0.0,
            ))
    joined = join_as(f"{name.replace('Tire', '')}Wheel_Wheel", parts)
    joined["shared_geometry_role"] = "front-wheel" if name == "FrontTire" else "rear-wheel"
    return wheel


def add_bike(root: bpy.types.Object) -> bpy.types.Object:
    bike = empty("RRR_RivalBikeVisual", (0.0, 0.0, 0.0), root, display_size=0.3)
    bike["presentation_only"] = True
    bike["wheelbase_m"] = 2.36

    primary_parts = [
        tapered_box("TankPrimary", (0.5, 0.31), (0.36, 0.23), 0.63, (0.0, 0.17, 1.24), "primary", bike, bevel_width=0.045),
        side_prism("LeftRearPanel", -0.31, 0.1, ((-0.32, 1.35), (-0.45, 1.08), (-0.94, 1.09), (-1.0, 1.29), (-0.7, 1.39)), "primary", bike, bevel_width=0.022),
        side_prism("RightRearPanel", 0.31, 0.1, ((-0.32, 1.35), (-0.45, 1.08), (-0.94, 1.09), (-1.0, 1.29), (-0.7, 1.39)), "primary", bike, bevel_width=0.022),
        tapered_box("RearFenderPrimary", (0.44, 0.09), (0.23, 0.05), 1.02, (0.0, -1.02, 1.34), "primary", bike, bevel_width=0.025),
    ]
    join_as("BikeStatic_Primary", primary_parts)

    accent_parts = [
        side_prism("LeftShroud", -0.29, 0.115, ((0.47, 1.39), (0.39, 1.04), (0.04, 0.94), (-0.35, 1.12), (-0.31, 1.35)), "accent", bike, bevel_width=0.024),
        side_prism("RightShroud", 0.29, 0.115, ((0.47, 1.39), (0.39, 1.04), (0.04, 0.94), (-0.35, 1.12), (-0.31, 1.35)), "accent", bike, bevel_width=0.024),
        tapered_box("TankAccent", (0.39, 0.13), (0.27, 0.1), 0.54, (0.0, 0.16, 1.4), "accent", bike, bevel_width=0.024),
        box("SeatAccent", (0.42, 0.85, 0.14), (0.0, -0.52, 1.39), "accent", bike, rotation=(0.025, 0.0, 0.0), bevel_width=0.045),
    ]
    join_as("BikeStatic_Accent", accent_parts)

    hardware_parts = [
        cylinder_between("FrameLeft", (-0.2, -0.56, 1.08), (-0.17, 0.46, 1.25), 0.052, "hardware", bike),
        cylinder_between("FrameRight", (0.2, -0.56, 1.08), (0.17, 0.46, 1.25), 0.052, "hardware", bike),
        cylinder_between("FrameDownLeft", (-0.17, 0.46, 1.25), (-0.2, -0.05, 0.64), 0.055, "hardware", bike),
        cylinder_between("FrameDownRight", (0.17, 0.46, 1.25), (0.2, -0.05, 0.64), 0.055, "hardware", bike),
        box("EngineBlock", (0.45, 0.43, 0.4), (0.0, -0.02, 0.72), "hardware", bike, rotation=(0.08, 0.0, 0.0), bevel_width=0.052),
        cylinder("EngineCoverRight", 0.19, 0.065, (0.26, -0.04, 0.7), "hardware", bike, vertices=12, rotation=(0.0, math.pi / 2, 0.0)),
        cylinder("EngineCoverLeft", 0.17, 0.055, (-0.25, -0.04, 0.71), "hardware", bike, vertices=12, rotation=(0.0, math.pi / 2, 0.0)),
        box("SkidPlate", (0.51, 0.5, 0.065), (0.0, -0.03, 0.43), "hardware", bike, bevel_width=0.018),
        cylinder("ExhaustCanister", 0.095, 0.55, (0.39, -0.82, 1.03), "hardware", bike, vertices=12, rotation=(math.pi / 2, 0.0, 0.0)),
        cylinder("ExhaustTip", 0.067, 0.14, (0.39, -1.16, 1.03), "hardware", bike, vertices=12, rotation=(math.pi / 2, 0.0, 0.0)),
        cylinder_between("ExhaustHeader", (0.23, 0.16, 0.82), (0.38, -0.52, 1.0), 0.043, "hardware", bike),
    ]
    rear_pivot = empty("bike-rear-suspension-pivot", (0.0, -0.38, 0.8), bike, display_size=0.12)
    hardware_parts.extend([
        cylinder_between("SwingarmLeft", (-0.21, -0.38, 0.8), (-0.18, -1.18, 0.62), 0.05, "hardware", bike),
        cylinder_between("SwingarmRight", (0.21, -0.38, 0.8), (0.18, -1.18, 0.62), 0.05, "hardware", bike),
    ])
    steering = empty("bike-steering-pivot", (0.0, 0.62, 1.48), bike, display_size=0.13)
    front_pivot = empty("bike-front-suspension-pivot", (0.0, 0.0, 0.0), steering, display_size=0.11)
    hardware_parts.extend([
        cylinder_between("ForkLeft", (-0.18, 0.62, 1.48), (-0.18, 1.18, 0.62), 0.055, "hardware", bike),
        cylinder_between("ForkRight", (0.18, 0.62, 1.48), (0.18, 1.18, 0.62), 0.055, "hardware", bike),
        box("Handlebar", (0.98, 0.085, 0.085), (0.0, 0.61, 1.68), "hardware", bike, bevel_width=0.014),
    ])
    join_as("BikeStatic_Hardware", hardware_parts)
    create_number_field(bike)
    add_wheel("FrontTire", (0.0, 0.56, -0.86), front_pivot)
    add_wheel("RearTire", (0.0, -0.8, -0.18), rear_pivot)
    return bike


def add_arm(
    side: str,
    pivot_location: tuple[float, float, float],
    parent: bpy.types.Object,
) -> bpy.types.Object:
    left = side == "left"
    sign = -1.0 if left else 1.0
    pivot = empty(f"rider-{side}-arm-pivot", pivot_location, parent, display_size=0.09)
    elbow = (sign * 0.3, 0.31, -0.12)
    hand = (sign * 0.18, 0.76, -0.25)
    parts = [
        cylinder_between("UpperArm", (0.0, 0.0, 0.0), elbow, 0.085, "accent", pivot, vertices=8),
        cylinder_between("Forearm", elbow, hand, 0.072, "accent", pivot, vertices=8),
        ico("Glove", (0.18, 0.17, 0.15), hand, "accent", pivot, subdivisions=1),
        box("ElbowGuard", (0.17, 0.13, 0.14), elbow, "accent", pivot, bevel_width=0.025),
    ]
    join_as(f"Rival{'Left' if left else 'Right'}Arm_Accent", parts)
    return pivot


def add_leg(
    side: str,
    pivot_location: tuple[float, float, float],
    parent: bpy.types.Object,
) -> bpy.types.Object:
    left = side == "left"
    sign = -1.0 if left else 1.0
    pivot = empty(f"rider-{side}-leg-pivot", pivot_location, parent, display_size=0.1)
    knee = (sign * 0.18, 0.4, -0.32)
    ankle = (sign * 0.2, 0.11, -0.59)
    parts = [
        cylinder_between("Thigh", (0.0, 0.0, 0.0), knee, 0.11, "primary", pivot, vertices=8),
        cylinder_between("Shin", knee, ankle, 0.09, "primary", pivot, vertices=8),
        box("HipArmor", (0.22, 0.23, 0.2), (sign * 0.07, -0.02, -0.03), "primary", pivot, bevel_width=0.035),
        box("KneeGuard", (0.23, 0.18, 0.24), knee, "primary", pivot, rotation=(-0.26, 0.0, sign * 0.12), bevel_width=0.035),
        box("Boot", (0.25, 0.36, 0.29), (ankle[0], ankle[1] + 0.05, ankle[2] - 0.07), "primary", pivot, rotation=(-0.08, 0.0, 0.0), bevel_width=0.034),
    ]
    join_as(f"Rival{'Left' if left else 'Right'}Leg_Primary", parts)
    return pivot


def add_rider(root: bpy.types.Object) -> bpy.types.Object:
    rider = empty("rival-rider", (0.0, 0.0, 0.0), root, display_size=0.27)
    rider["pose_pivot_count"] = 6
    torso = empty("rider-torso-pivot", (0.0, -0.39, 1.55), rider, display_size=0.11)
    torso_parts = [
        cone("Torso", 0.23, 0.34, 0.58, (0.0, 0.2, 0.27), "primary", torso, vertices=10, rotation=(-0.52, 0.0, 0.0), scale=(1.0, 0.69, 1.0), bevel_width=0.025),
        box("ChestArmor", (0.43, 0.08, 0.32), (0.0, 0.38, 0.28), "primary", torso, rotation=(-0.52, 0.0, 0.0), bevel_width=0.042),
        box("BackArmor", (0.42, 0.075, 0.31), (0.0, -0.02, 0.27), "primary", torso, rotation=(-0.52, 0.0, 0.0), bevel_width=0.04),
    ]
    join_as("RivalTorso_Primary", torso_parts)

    head = empty("rider-head-pivot", (0.0, 0.46, 0.53), torso, display_size=0.09)
    head_parts = [
        ico("HelmetShell", (0.5, 0.56, 0.43), (0.0, 0.04, 0.17), "accent", head, subdivisions=2, smooth=True),
        tapered_box("HelmetChin", (0.34, 0.13), (0.4, 0.17), 0.3, (0.0, 0.29, -0.055), "accent", head, bevel_width=0.034),
        box("HelmetVisorInset", (0.42, 0.05, 0.16), (0.0, 0.39, 0.17), "accent", head, rotation=(-0.08, 0.0, 0.0), bevel_width=0.035),
        tapered_box("HelmetPeak", (0.4, 0.032), (0.28, 0.07), 0.36, (0.0, 0.27, 0.35), "accent", head, bevel_width=0.022),
    ]
    join_as("RivalHead_Accent", head_parts)

    add_arm("left", (-0.34, 0.18, 0.41), torso)
    add_arm("right", (0.34, 0.18, 0.41), torso)
    add_leg("left", (-0.2, -0.39, 1.5), rider)
    add_leg("right", (0.2, -0.39, 1.5), rider)
    return rider


def descendants(obj: bpy.types.Object) -> list[bpy.types.Object]:
    result = [obj]
    for child in obj.children:
        result.extend(descendants(child))
    return result


def build_scene() -> bpy.types.Object:
    global ASSET_COLLECTION
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = SCENE_NAME
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.world = bpy.data.worlds.new("RRR Rival Pack Source World")
    scene.world.color = (0.04, 0.04, 0.04)
    NAME_COUNTS.clear()
    ASSET_COLLECTION = bpy.data.collections.new("Rival Pack — Runtime Base")
    scene.collection.children.link(ASSET_COLLECTION)
    create_materials()

    root = empty(ROOT_NAME, (0.0, 0.0, 0.0), display_size=0.36)
    root["asset_root"] = True
    root["asset_source"] = "Original project-authored Blender-native geometry"
    root["authoring_script_sha256"] = AUTHORING_SCRIPT_SHA256
    root["authoring_blender_version"] = bpy.app.version_string
    root["source_schema"] = "rrr-rival-pack-v1"
    root["source_pair_id"] = str(uuid.uuid4())
    root["contract"] = "docs/design/RIVAL_PACK_VERTICAL_SLICE.md"
    root["units"] = "meters"
    root["forward_axis"] = "+Y"
    root["up_axis"] = "+Z"
    root["gameplay_authority"] = "presentation-only"
    root["shared_geometry"] = True
    root["variant_numbers"] = "17,31,46,58,73"
    add_bike(root)
    add_rider(root)

    names = [obj.name for obj in bpy.data.objects]
    assert len(names) == len(set(names)), "Every exported node name must be unique"
    assert set(names) == set(REQUIRED_NODE_NAMES), "Rival source hierarchy changed"
    mesh_count = sum(1 for obj in descendants(root) if obj.type == "MESH")
    primitive_count = sum(len(obj.data.materials) for obj in descendants(root) if obj.type == "MESH")
    assert 8 <= mesh_count <= 12, f"Rival source has {mesh_count} mesh nodes; expected 8–12"
    assert 8 <= primitive_count <= 12, f"Rival source has {primitive_count} primitives; expected 8–12"
    return root


def save_and_export(output_dir: Path, root: bpy.types.Object) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    blend_path = (output_dir / "rival-pack-source.blend").resolve()
    glb_path = (output_dir / "rival-pack-raw.glb").resolve()
    bpy.context.preferences.filepaths.save_version = 0
    sanitize_saved_workspace_metadata()
    bpy.ops.wm.save_as_mainfile(
        filepath=str(blend_path),
        check_existing=False,
        compress=False,
    )
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
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
        export_image_format="AUTO",
    )
    return blend_path, glb_path


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def set_variant_materials(
    number: str,
    primary: tuple[float, float, float, float],
    accent: tuple[float, float, float, float],
) -> None:
    for key, color in (("primary", primary), ("accent", accent)):
        material = MATERIALS[key]
        material.diffuse_color = color
        node = material.node_tree.nodes.get("Principled BSDF")
        if node is not None:
            node.inputs["Base Color"].default_value = color
    update_number_image(number, primary, accent)


def compose_contact_sheet(panel_paths: tuple[Path, ...], output_path: Path) -> Path:
    panel_width = 640
    panel_height = 450
    columns = 3
    rows = 2
    width = panel_width * columns
    height = panel_height * rows
    background = (0.025, 0.03, 0.035, 1.0)
    pixels = array("f", background) * (width * height)
    for index, panel_path in enumerate(panel_paths):
        panel = bpy.data.images.load(str(panel_path), check_existing=False)
        if tuple(panel.size) != (panel_width, panel_height):
            raise ValueError(f"Unexpected preview size: {panel_path}")
        source = array("f", panel.pixels[:])
        column = index % columns
        row_from_top = index // columns
        destination_y = (rows - 1 - row_from_top) * panel_height
        row_values = panel_width * 4
        for row in range(panel_height):
            source_start = row * row_values
            destination_start = (
                (destination_y + row) * width + column * panel_width
            ) * 4
            pixels[destination_start : destination_start + row_values] = (
                source[source_start : source_start + row_values]
            )
    sheet = bpy.data.images.new(
        "RivalPackVariantsContactSheet",
        width=width,
        height=height,
        alpha=True,
        float_buffer=False,
    )
    sheet.colorspace_settings.name = "sRGB"
    sheet.pixels.foreach_set(pixels)
    sheet.update()
    sheet.filepath_raw = str(output_path)
    sheet.file_format = "PNG"
    sheet.save()
    return output_path


def render_previews(output_dir: Path) -> tuple[Path, ...]:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    preview_collection = bpy.data.collections.new("Rival Source Preview — Not Exported")
    scene.collection.children.link(preview_collection)

    bpy.ops.mesh.primitive_plane_add(size=20, location=(0.0, 0.0, -0.015))
    ground = bpy.context.object
    for collection in tuple(ground.users_collection):
        collection.objects.unlink(ground)
    preview_collection.objects.link(ground)
    ground_material = bpy.data.materials.new("RivalPreviewGround")
    ground_material.diffuse_color = (0.15, 0.14, 0.13, 1.0)
    ground.data.materials.append(ground_material)

    camera_data = bpy.data.cameras.new("RivalPreviewCameraData")
    camera = bpy.data.objects.new("RivalPreviewCamera", camera_data)
    preview_collection.objects.link(camera)
    camera.location = (5.15, -5.75, 2.9)
    camera_data.lens = 58
    look_at(camera, (0.0, -0.1, 1.22))
    scene.camera = camera
    for name, location, energy, size in (
        ("RivalPreviewKey", (4.5, -4.0, 6.0), 1150.0, 5.0),
        ("RivalPreviewFill", (-4.0, -1.0, 3.5), 740.0, 4.0),
        ("RivalPreviewRim", (1.0, 4.0, 5.2), 980.0, 3.5),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        light.location = location
        preview_collection.objects.link(light)
        look_at(light, (0.0, 0.0, 1.1))

    set_variant_materials(*VARIANTS[0])
    preview_path = (output_dir / "rival-pack-preview.png").resolve()
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 900
    scene.render.filepath = str(preview_path)
    bpy.ops.render.render(write_still=True)

    scene.render.resolution_x = 640
    scene.render.resolution_y = 450
    panel_paths: list[Path] = []
    for number, primary, accent in VARIANTS:
        set_variant_materials(number, primary, accent)
        panel_path = (output_dir / f"rival-pack-preview-{number}.png").resolve()
        scene.render.filepath = str(panel_path)
        bpy.ops.render.render(write_still=True)
        panel_paths.append(panel_path)
    set_variant_materials(*VARIANTS[0])
    contact_path = (output_dir / "rival-pack-variants-contact-sheet.png").resolve()
    compose_contact_sheet(tuple(panel_paths), contact_path)
    return (preview_path, *panel_paths, contact_path)


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser()
    if not output_dir.is_absolute():
        output_dir = Path.cwd() / output_dir
    root = build_scene()
    node_count = len(descendants(root))
    mesh_count = sum(1 for obj in descendants(root) if obj.type == "MESH")
    triangle_count = 0
    for obj in descendants(root):
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        triangle_count += len(obj.data.loop_triangles)
    assert 15_000 <= triangle_count <= 20_000, (
        f"Rival source has {triangle_count} triangles; expected 15,000–20,000"
    )
    material_count = len(MATERIALS)
    blend_path, glb_path = save_and_export(output_dir, root)
    preview_paths = render_previews(output_dir)
    print(f"Rival root: {root.name}")
    print(f"Rival nodes: {node_count}")
    print(f"Rival mesh objects: {mesh_count}")
    print(f"Rival materials: {material_count}")
    print(f"Rival triangles: {triangle_count}")
    print(f"Saved Blender source: {blend_path}")
    print(f"Exported raw GLB: {glb_path}")
    for preview_path in preview_paths:
        print(f"Rendered source preview: {preview_path}")


if __name__ == "__main__":
    main()
