import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getBounds, NodeIO, PropertyType } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { dedup, join, meshopt, prune } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

import { inspectPngIntegrity } from "./lib/png-integrity.mjs";

const OPTIMIZER_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(OPTIMIZER_PATH), "..");
const VERIFIER_PATH = path.join(ROOT, "scripts/verify-hero-bike-rider-assets.mjs");
const PNG_INTEGRITY_PATH = path.join(ROOT, "scripts/lib/png-integrity.mjs");
const SOURCE_DIR = path.join(ROOT, "art-source/blender/hero-bike-rider/generated");
const SOURCE_BLEND_PATH = path.join(SOURCE_DIR, "hero-bike-rider-source.blend");
const SOURCE_GLB_PATH = path.join(SOURCE_DIR, "hero-bike-rider-raw.glb");
const SOURCE_PREVIEW_PATH = path.join(SOURCE_DIR, "hero-bike-rider-preview.png");
const SOURCE_PREVIEW_CONTACT_SHEET_PATH = path.join(
  SOURCE_DIR,
  "hero-bike-rider-preview-contact-sheet.png",
);
const SOURCE_PREVIEW_PANEL_SPECS = Object.freeze([
  { angle: "rear-right", path: path.join(SOURCE_DIR, "hero-bike-rider-preview-rear-right.png") },
  { angle: "right-profile", path: path.join(SOURCE_DIR, "hero-bike-rider-preview-right-profile.png") },
  { angle: "left-profile", path: path.join(SOURCE_DIR, "hero-bike-rider-preview-left-profile.png") },
  { angle: "front-left", path: path.join(SOURCE_DIR, "hero-bike-rider-preview-front-left.png") },
]);
const SOURCE_README_PATH = path.join(ROOT, "art-source/blender/hero-bike-rider/README.md");
const AUTHORING_SCRIPT_PATH = path.join(
  ROOT,
  "art-source/blender/hero-bike-rider/build_hero_bike_rider.py",
);
const REFERENCE_PATH = path.join(
  ROOT,
  "docs/design/concepts/hero-bike-rider-production-reference.png",
);
const CONTRACT_PATH = path.join(ROOT, "docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md");
const OUTPUT_DIR = path.join(ROOT, "public/assets/3d");
const OUTPUT_GLB_PATH = path.join(OUTPUT_DIR, "hero-bike-rider.glb");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "asset-manifest.json");
const PACKAGE_PATH = path.join(ROOT, "package.json");

const SCENE_NAME = "RRR_HeroBikeRiderScene";
const ROOT_NAME = "RRR_HeroBikeRider";
const MAX_MATERIALS = 10;
const MAX_TRIANGLES = 70_000;
const MAX_BIKE_TRIANGLES = 40_000;
const MAX_RIDER_TRIANGLES = 30_000;
const MAX_WHEEL_TRIANGLES = 18_000;
const MAX_NODES = 96;
const MAX_RUNTIME_MESH_BEARING_NODES = 28;
const MAX_RUNTIME_RENDER_PRIMITIVES = 28;
const MAX_RUNTIME_BYTES = 3 * 1024 * 1024;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BASIS_RUNTIME_FILES = Object.freeze([
  {
    path: "public/assets/transcoders/basis/basis_transcoder.js",
    bytes: 57_529,
    sha256: "8478b5b6d6b74e7d3082b89f6417321d8d1dc0307f2b30d4484bb11b441696a1",
  },
  {
    path: "public/assets/transcoders/basis/basis_transcoder.wasm",
    bytes: 527_333,
    sha256: "6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a",
  },
  {
    path: "public/assets/transcoders/basis/README.md",
    bytes: 1_388,
    sha256: "a578df416c1e0852e9c36a1cf91b4d28d91a251294f87ce610a3bc7ca4df15e0",
  },
  {
    path: "public/assets/transcoders/basis/LICENSE.txt",
    bytes: 9_197,
    sha256: "a7d00bfd54525bc694b6e32f64c7ebcf5e6b7ae3657be5cc12767bce74654a47",
  },
  {
    path: "public/assets/transcoders/basis/NOTICE.txt",
    bytes: 917,
    sha256: "42beeb6710c933778e30f62886e0790ebba120debbb0545ab46c7292d3e5a061",
  },
]);

const EXPECTED_PARENT_BY_NAME = Object.freeze({
  RRR_HeroBikeRider: null,
  RRR_BikeVisual: ROOT_NAME,
  Bike_ChassisShell: "RRR_BikeVisual",
  Bike_TankAndRadiator: "RRR_BikeVisual",
  Bike_Seat: "RRR_BikeVisual",
  Bike_RearFender: "RRR_BikeVisual",
  Bike_LeftSidePanel: "RRR_BikeVisual",
  Bike_RightSidePanel: "RRR_BikeVisual",
  Bike_Engine: "RRR_BikeVisual",
  Bike_Exhaust: "RRR_BikeVisual",
  Bike_ChainDrive: "RRR_BikeVisual",
  "bike-steering-pivot": "RRR_BikeVisual",
  Bike_Handlebar: "bike-steering-pivot",
  Bike_FrontFork: "bike-steering-pivot",
  Bike_FrontFender: "bike-steering-pivot",
  NumberPlate: "bike-steering-pivot",
  "bike-front-suspension-pivot": "bike-steering-pivot",
  FrontTire: "bike-front-suspension-pivot",
  FrontTireRing: "FrontTire",
  FrontTreadRing: "FrontTire",
  FrontHub: "FrontTire",
  FrontSpokes: "FrontTire",
  FrontBrakeDisc: "FrontTire",
  "bike-rear-suspension-pivot": "RRR_BikeVisual",
  Bike_Swingarm: "bike-rear-suspension-pivot",
  RearTire: "bike-rear-suspension-pivot",
  RearTireRing: "RearTire",
  RearTreadRing: "RearTire",
  RearHub: "RearTire",
  RearSpokes: "RearTire",
  RearBrakeDisc: "RearTire",
  RearNumberPanel: "RRR_BikeVisual",
  RearNumber22: "RearNumberPanel",
  "bike-seat-anchor": "RRR_BikeVisual",
  "bike-left-hand-anchor": "RRR_BikeVisual",
  "bike-right-hand-anchor": "RRR_BikeVisual",
  "bike-left-boot-anchor": "RRR_BikeVisual",
  "bike-right-boot-anchor": "RRR_BikeVisual",
  "player-rider": ROOT_NAME,
  "rider-torso-pivot": "player-rider",
  Rider_Torso: "rider-torso-pivot",
  Rider_ChestArmor: "rider-torso-pivot",
  Rider_BackPlate: "rider-torso-pivot",
  JerseyNumber22: "Rider_BackPlate",
  "rider-head-pivot": "rider-torso-pivot",
  Rider_Head: "rider-head-pivot",
  Rider_Helmet: "rider-head-pivot",
  Rider_Visor: "rider-head-pivot",
  Rider_HelmetPeak: "rider-head-pivot",
  "rider-left-arm-pivot": "rider-torso-pivot",
  Rider_LeftArm: "rider-left-arm-pivot",
  "rider-right-arm-pivot": "rider-torso-pivot",
  Rider_RightArm: "rider-right-arm-pivot",
  Rider_Hips: "player-rider",
  "rider-left-leg-pivot": "player-rider",
  Rider_LeftLeg: "rider-left-leg-pivot",
  "rider-right-leg-pivot": "player-rider",
  Rider_RightLeg: "rider-right-leg-pivot",
});

const CONTRACT_NODE_NAMES = Object.freeze(Object.keys(EXPECTED_PARENT_BY_NAME));
const MATERIAL_CONTRACT = Object.freeze({
  RRR_PlasticTeal: { roughness: [0.48, 0.62], metallic: [0, 0] },
  RRR_PlasticCoral: { roughness: [0.48, 0.62], metallic: [0, 0] },
  RRR_PlateCream: { roughness: [0.58, 0.72], metallic: [0, 0] },
  RRR_Rubber: { roughness: [0.86, 0.96], metallic: [0, 0] },
  RRR_MetalDark: { roughness: [0.38, 0.62], metallic: [0.45, 0.85] },
  RRR_MetalBright: { roughness: [0.25, 0.48], metallic: [0.65, 0.95] },
  RRR_RiderFabric: { roughness: [0.76, 0.9], metallic: [0, 0] },
  RRR_RiderArmor: { roughness: [0.5, 0.72], metallic: [0, 0] },
  RRR_Visor: { roughness: [0.18, 0.32], metallic: [0.05, 0.18] },
  RRR_NumberCream: { roughness: [0.62, 0.78], metallic: [0, 0] },
});
const REQUIRED_MATERIAL_NAMES = Object.freeze(Object.keys(MATERIAL_CONTRACT));
const SEMANTIC_MATERIAL_BINDINGS = Object.freeze([
  { node: "BikeStatic_NumberCream", parent: "RRR_BikeVisual", material: "RRR_NumberCream" },
  { node: "RiderTorso_NumberCream", parent: "rider-torso-pivot", material: "RRR_NumberCream" },
]);
const OPTIMIZATION_PRESERVED_NODE_NAME_SET = new Set([
  ...CONTRACT_NODE_NAMES,
  ...SEMANTIC_MATERIAL_BINDINGS.map((binding) => binding.node),
]);
const POSE_HOOK_NAMES = Object.freeze([
  "rider-torso-pivot",
  "rider-head-pivot",
  "rider-left-arm-pivot",
  "rider-right-arm-pivot",
  "rider-left-leg-pivot",
  "rider-right-leg-pivot",
]);
const ANCHOR_NAMES = Object.freeze([
  "bike-seat-anchor",
  "bike-left-hand-anchor",
  "bike-right-hand-anchor",
  "bike-left-boot-anchor",
  "bike-right-boot-anchor",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function fileRecord(filePath, bytes, extra = {}) {
  return {
    path: relative(filePath),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    ...extra,
  };
}

function parseGlbJson(bytes, label) {
  const data = Buffer.from(bytes);
  assert(data.byteLength >= 20, `${label} is too short to be a GLB`);
  assert(data.readUInt32LE(0) === 0x46546c67, `${label} has invalid GLB magic`);
  assert(data.readUInt32LE(4) === 2, `${label} must use glTF 2.0`);
  assert(data.readUInt32LE(8) === data.byteLength, `${label} declared byte length does not match`);
  const jsonLength = data.readUInt32LE(12);
  assert(data.readUInt32LE(16) === 0x4e4f534a, `${label} must begin with a JSON chunk`);
  assert(20 + jsonLength <= data.byteLength, `${label} JSON chunk is out of bounds`);
  const jsonText = data.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/u, "").trim();
  return JSON.parse(jsonText);
}

function inspectPreview(bytes) {
  return inspectPngIntegrity(bytes, "Hero source preview", {
    width: 1280,
    height: 900,
    bitDepth: 8,
    colorType: 6,
  });
}

function assertSerializedRestrictions(json, label, { optimized }) {
  assert((json.scenes ?? []).length === 1, `${label} must contain exactly one scene`);
  assert(json.scenes[0]?.name === SCENE_NAME, `${label} scene must be named ${SCENE_NAME}`);
  assert((json.images ?? []).length === 0, `${label} must not contain images`);
  assert((json.textures ?? []).length === 0, `${label} must not contain textures`);
  assert((json.samplers ?? []).length === 0, `${label} must not contain texture samplers`);
  assert((json.cameras ?? []).length === 0, `${label} must not contain cameras`);
  assert((json.skins ?? []).length === 0, `${label} must not contain skins`);
  assert((json.animations ?? []).length === 0, `${label} must not contain animations`);
  assert(
    !(json.extensionsUsed ?? []).includes("KHR_lights_punctual"),
    `${label} must not contain punctual lights`,
  );
  assert(
    json.extensions?.KHR_lights_punctual === undefined,
    `${label} must not contain a punctual-light extension payload`,
  );
  const expectedExtensions = optimized
    ? ["EXT_meshopt_compression", "KHR_mesh_quantization"].sort()
    : [];
  assert(
    JSON.stringify([...(json.extensionsUsed ?? [])].sort()) === JSON.stringify(expectedExtensions),
    `${label} must declare exactly its approved used extensions`,
  );
  assert(
    JSON.stringify([...(json.extensionsRequired ?? [])].sort()) === JSON.stringify(expectedExtensions),
    `${label} must declare exactly its approved required extensions`,
  );
  const buffers = json.buffers ?? [];
  if (optimized) {
    assert(buffers.length === 2, `${label} must contain one payload and one Meshopt fallback buffer`);
    assert(
      buffers[0]?.uri === undefined && buffers[0]?.extensions === undefined,
      `${label} compressed payload buffer must be embedded and unextended`,
    );
    assert(
      JSON.stringify(buffers[1]?.extensions)
        === JSON.stringify({ EXT_meshopt_compression: { fallback: true } })
        && buffers[1]?.uri === undefined,
      `${label} second buffer must be the URI-less Meshopt fallback declaration`,
    );
  } else {
    assert(
      buffers.length === 1 && buffers[0]?.uri === undefined,
      `${label} must contain exactly one embedded GLB buffer`,
    );
  }

  const nodes = json.nodes ?? [];
  const namesByIndex = nodes.map((node) => node.name ?? "");
  assert(
    new Set(namesByIndex).size === namesByIndex.length,
    `${label} must give every node a unique name`,
  );
  const sceneRootNames = (json.scenes[0]?.nodes ?? []).map((index) => namesByIndex[index]);
  assert(
    JSON.stringify(sceneRootNames) === JSON.stringify([ROOT_NAME]),
    `${label} must contain one ${ROOT_NAME} scene root`,
  );

  const parentByName = new Map(namesByIndex.map((name) => [name, null]));
  for (const [parentIndex, node] of nodes.entries()) {
    for (const childIndex of node.children ?? []) {
      const childName = namesByIndex[childIndex];
      const parentName = namesByIndex[parentIndex];
      assert(childName, `${label} contains an unnamed or invalid child node`);
      assert(parentByName.get(childName) === null, `${label} node ${childName} has multiple parents`);
      parentByName.set(childName, parentName);
    }
  }
  for (const [name, expectedParent] of Object.entries(EXPECTED_PARENT_BY_NAME)) {
    assert(parentByName.has(name), `${label} is missing required node ${name}`);
    assert(
      parentByName.get(name) === expectedParent,
      `${label} node ${name} must be parented to ${expectedParent ?? "the scene"}`,
    );
  }
}

function assertOptimizedGeometryEncoding(json, label) {
  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];
  const geometryAccessors = [];
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      assert(Number.isInteger(primitive.indices), `${label} primitives must use indexed geometry`);
      assert((primitive.targets ?? []).length === 0, `${label} must not contain morph targets`);
      geometryAccessors.push({ index: primitive.indices, semantic: "INDICES" });
      for (const [semantic, index] of Object.entries(primitive.attributes ?? {})) {
        assert(
          semantic === "POSITION"
            || semantic === "NORMAL"
            || semantic === "TANGENT"
            || semantic.startsWith("TEXCOORD_")
            || semantic.startsWith("COLOR_"),
          `${label} contains unsupported geometry semantic ${semantic}`,
        );
        geometryAccessors.push({ index, semantic });
      }
    }
  }
  assert(geometryAccessors.some(({ semantic }) => semantic === "POSITION"), `${label} needs POSITION data`);
  for (const { index, semantic } of geometryAccessors) {
    assert(Number.isInteger(index) && accessors[index], `${label} ${semantic} accessor index is invalid`);
    const accessor = accessors[index];
    assert(accessor.sparse === undefined, `${label} ${semantic} must not use sparse accessors`);
    assert(Number.isInteger(accessor.bufferView), `${label} ${semantic} must use a bufferView`);
    const bufferView = bufferViews[accessor.bufferView];
    const meshoptExtension = bufferView?.extensions?.EXT_meshopt_compression;
    assert(meshoptExtension, `${label} ${semantic} bufferView must use EXT_meshopt_compression`);
    assert(bufferView.buffer === 1, `${label} ${semantic} fallback view must target buffer 1`);
    assert(meshoptExtension.buffer === 0, `${label} ${semantic} compressed payload must target buffer 0`);
    assert(
      Number.isInteger(meshoptExtension.byteLength) && meshoptExtension.byteLength > 0,
      `${label} ${semantic} Meshopt byteLength must be positive`,
    );
    assert(
      Number.isInteger(meshoptExtension.count) && meshoptExtension.count > 0,
      `${label} ${semantic} Meshopt count must be positive`,
    );
    if (semantic === "INDICES") {
      assert(
        meshoptExtension.mode === "TRIANGLES" || meshoptExtension.mode === "INDICES",
        `${label} index data must use a Meshopt index mode`,
      );
    } else {
      assert(meshoptExtension.mode === "ATTRIBUTES", `${label} ${semantic} must use Meshopt attribute mode`);
    }
    if (semantic === "POSITION") {
      assert(accessor.type === "VEC3", `${label} POSITION must use VEC3 accessors`);
      assert(accessor.componentType === 5122, `${label} POSITION must use normalized 16-bit signed quantization`);
      assert(accessor.normalized === true, `${label} POSITION quantization must be normalized`);
    }
    if (semantic === "NORMAL") {
      assert(accessor.type === "VEC3", `${label} NORMAL must use VEC3 accessors`);
      assert(accessor.componentType === 5120, `${label} high/filter Meshopt normals must use signed bytes`);
      assert(accessor.normalized === true, `${label} high/filter Meshopt normals must be normalized`);
      assert(meshoptExtension.filter === "OCTAHEDRAL", `${label} NORMAL must use the octahedral filter`);
    }
    if (semantic === "TANGENT") {
      assert(accessor.type === "VEC4", `${label} TANGENT must use VEC4 accessors`);
      assert(accessor.componentType === 5120, `${label} high/filter Meshopt tangents must use signed bytes`);
      assert(accessor.normalized === true, `${label} high/filter Meshopt tangents must be normalized`);
      assert(meshoptExtension.filter === "OCTAHEDRAL", `${label} TANGENT must use the octahedral filter`);
    }
    if (semantic.startsWith("TEXCOORD_")) {
      assert(accessor.type === "VEC2", `${label} ${semantic} must use VEC2 accessors`);
      assert(accessor.componentType === 5123, `${label} ${semantic} must use unsigned 16-bit quantization`);
      assert(accessor.normalized === true, `${label} ${semantic} quantization must be normalized`);
    }
    if (semantic.startsWith("COLOR_")) {
      assert(accessor.componentType === 5121, `${label} ${semantic} must use unsigned 8-bit quantization`);
      assert(accessor.normalized === true, `${label} ${semantic} quantization must be normalized`);
    }
  }
}

function assertIdentity(node, label = node.getName()) {
  const translation = node.getTranslation();
  const rotation = node.getRotation();
  const scale = node.getScale();
  assert(translation.every((value) => Math.abs(value) <= 1e-7), `${label} translation must be identity`);
  assert(
    Math.abs(rotation[0]) <= 1e-7
      && Math.abs(rotation[1]) <= 1e-7
      && Math.abs(rotation[2]) <= 1e-7
      && Math.abs(rotation[3] - 1) <= 1e-7,
    `${label} rotation must be identity`,
  );
  assert(scale.every((value) => Math.abs(value - 1) <= 1e-7), `${label} scale must be identity`);
}

function indexNodes(document) {
  const nodes = document.getRoot().listNodes();
  const nodesByName = new Map(nodes.map((node) => [node.getName(), node]));
  assert(nodesByName.size === nodes.length, "Every hero bike/rider node must have a unique name");
  assert(
    nodes.every((node) => node.getName() && !/\.\d{3}$/u.test(node.getName())),
    "Hero bike/rider nodes must use stable semantic names without Blender numeric suffixes",
  );
  return nodesByName;
}

function requiredNode(nodesByName, name) {
  const node = nodesByName.get(name);
  assert(node, `Hero bike/rider document is missing required node ${name}`);
  return node;
}

function assertNear(actual, expected, tolerance, label) {
  assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function assertFactorRange(value, range, label) {
  assert(Number.isFinite(value), `${label} must be finite`);
  assert(
    value >= range[0] - 1e-6 && value <= range[1] + 1e-6,
    `${label} must be within ${range[0]}-${range[1]}; received ${value}`,
  );
}

function assertMaterialContract(document, label) {
  const materials = document.getRoot().listMaterials();
  const names = materials.map((material) => material.getName());
  assert(
    JSON.stringify([...names].sort()) === JSON.stringify([...REQUIRED_MATERIAL_NAMES].sort()),
    `${label} must contain exactly the ten semantic hero materials`,
  );
  for (const material of materials) {
    const name = material.getName();
    const contract = MATERIAL_CONTRACT[name];
    assert(contract, `${label} contains unapproved material ${name}`);
    assertFactorRange(material.getRoughnessFactor(), contract.roughness, `${label} ${name} roughness`);
    assertFactorRange(material.getMetallicFactor(), contract.metallic, `${label} ${name} metallic`);
    assert(material.getAlphaMode() === "OPAQUE", `${label} ${name} must use OPAQUE alpha mode`);
    const baseColor = material.getBaseColorFactor();
    assert(
      baseColor.length === 4 && baseColor.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
      `${label} ${name} base-color factor must be finite RGBA in 0-1`,
    );
    assertNear(baseColor[3], 1, 1e-7, `${label} ${name} base-color alpha`);
    assert(
      material.getEmissiveFactor().every((value) => Math.abs(value) <= 1e-7),
      `${label} ${name} must not be emissive`,
    );
  }
}

function assertSemanticMaterialBindings(nodesByName, label) {
  for (const binding of SEMANTIC_MATERIAL_BINDINGS) {
    const node = requiredNode(nodesByName, binding.node);
    assert(
      node.getParentNode()?.getName() === binding.parent,
      `${label} ${binding.node} must remain under ${binding.parent}`,
    );
    const primitives = node.getMesh()?.listPrimitives() ?? [];
    assert(primitives.length === 1, `${label} ${binding.node} must contain exactly one render primitive`);
    assert(
      primitives[0].getMaterial()?.getName() === binding.material,
      `${label} ${binding.node} must use only ${binding.material}`,
    );
  }
}

function assertDocumentContract(
  document,
  label,
  authoringScriptSha256,
  expectedSourcePairId = null,
) {
  const root = document.getRoot();
  const scenes = root.listScenes();
  assert(scenes.length === 1, `${label} must contain exactly one scene`);
  assert(scenes[0]?.getName() === SCENE_NAME, `${label} scene must be named ${SCENE_NAME}`);
  const sceneChildren = scenes[0]?.listChildren() ?? [];
  assert(
    sceneChildren.length === 1 && sceneChildren[0]?.getName() === ROOT_NAME,
    `${label} must contain one ${ROOT_NAME} scene root`,
  );

  const nodesByName = indexNodes(document);
  for (const [name, expectedParent] of Object.entries(EXPECTED_PARENT_BY_NAME)) {
    const node = requiredNode(nodesByName, name);
    const actualParent = node.getParentNode()?.getName() ?? null;
    assert(
      actualParent === expectedParent,
      `${label} node ${name} must be parented to ${expectedParent ?? "the scene"}`,
    );
  }
  assertIdentity(requiredNode(nodesByName, ROOT_NAME));
  assertIdentity(requiredNode(nodesByName, "RRR_BikeVisual"));
  assertIdentity(requiredNode(nodesByName, "player-rider"));

  const rootExtras = requiredNode(nodesByName, ROOT_NAME).getExtras();
  assert(rootExtras.asset_root === true, `${label} root must declare asset_root=true`);
  assert(
    rootExtras.asset_source === "Original project-authored Blender-native geometry",
    `${label} root has unexpected source provenance`,
  );
  assert(
    rootExtras.reference === "docs/design/concepts/hero-bike-rider-production-reference.png",
    `${label} root has unexpected reference provenance`,
  );
  assert(
    rootExtras.contract === "docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md",
    `${label} root has unexpected contract provenance`,
  );
  assert(rootExtras.units === "meters", `${label} root must declare meter units`);
  assert(rootExtras.forward_axis === "+Y", `${label} root must declare Blender +Y forward`);
  assert(rootExtras.up_axis === "+Z", `${label} root must declare Blender +Z up`);
  assert(rootExtras.gameplay_authority === "presentation-only", `${label} must be presentation-only`);
  assert(
    rootExtras.authoring_script_sha256 === authoringScriptSha256,
    `${label} must bind the current Blender authoring procedure`,
  );
  assert(
    rootExtras.authoring_blender_version === "4.5.11 LTS",
    `${label} must bind Blender 4.5.11 LTS`,
  );
  assert(rootExtras.source_schema === "rrr-hero-bike-rider-v1", `${label} source schema`);
  assert(
    typeof rootExtras.source_pair_id === "string" && UUID_V4_PATTERN.test(rootExtras.source_pair_id),
    `${label} must declare a UUIDv4 source-pair identifier`,
  );
  if (expectedSourcePairId !== null) {
    assert(
      rootExtras.source_pair_id === expectedSourcePairId,
      `${label} must come from the same Blender authoring run as the editable source`,
    );
  }
  assert(
    requiredNode(nodesByName, "FrontTire").getExtras().animated_axis === "+X"
      && requiredNode(nodesByName, "RearTire").getExtras().animated_axis === "+X",
    `${label} wheel roots must declare local +X as the animated axis`,
  );

  assert(root.listTextures().length === 0, `${label} must not contain textures`);
  assert(root.listCameras().length === 0, `${label} must not contain cameras`);
  assert(root.listSkins().length === 0, `${label} must not contain skins`);
  assert(root.listAnimations().length === 0, `${label} must not contain animations`);
  assert(root.listMaterials().length <= MAX_MATERIALS, `${label} exceeds its ${MAX_MATERIALS}-material budget`);
  assertMaterialContract(document, label);
  assertSemanticMaterialBindings(nodesByName, label);
  return nodesByName;
}

function countRenderedTrianglesForNodes(nodes) {
  let triangles = 0;
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const primitive of mesh.listPrimitives()) {
      assert(primitive.getMode() === 4, `${node.getName()} must use triangle primitives`);
      const indices = primitive.getIndices();
      const count = indices?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return triangles;
}

function countRenderedTriangles(document) {
  return countRenderedTrianglesForNodes(document.getRoot().listNodes());
}

function collectSubtreeNodes(roots) {
  const nodes = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || nodes.has(node)) continue;
    nodes.add(node);
    pending.push(...node.listChildren());
  }
  return nodes;
}

function collectTriangleBreakdown(document, nodesByName, label) {
  const heroNodes = collectSubtreeNodes([requiredNode(nodesByName, ROOT_NAME)]);
  const bikeNodes = collectSubtreeNodes([requiredNode(nodesByName, "RRR_BikeVisual")]);
  const riderNodes = collectSubtreeNodes([requiredNode(nodesByName, "player-rider")]);
  const wheelNodes = collectSubtreeNodes([
    requiredNode(nodesByName, "FrontTire"),
    requiredNode(nodesByName, "RearTire"),
  ]);
  assert(
    [...bikeNodes].every((node) => !riderNodes.has(node)),
    `${label} bike and rider subtrees must not overlap`,
  );
  const renderedNodes = document.getRoot().listNodes().filter((node) => node.getMesh());
  assert(
    renderedNodes.every((node) => heroNodes.has(node)),
    `${label} must not contain render geometry outside ${ROOT_NAME}`,
  );
  const total = countRenderedTrianglesForNodes(heroNodes);
  const bikeIncludingWheels = countRenderedTrianglesForNodes(bikeNodes);
  const rider = countRenderedTrianglesForNodes(riderNodes);
  const wheelsCombined = countRenderedTrianglesForNodes(wheelNodes);
  assert(total === countRenderedTriangles(document), `${label} triangle accounting must cover the document`);
  assert(total === bikeIncludingWheels + rider, `${label} triangle accounting must split into bike and rider`);
  assert(bikeIncludingWheels <= MAX_BIKE_TRIANGLES, `${label} bike exceeds ${MAX_BIKE_TRIANGLES} triangles`);
  assert(rider <= MAX_RIDER_TRIANGLES, `${label} rider exceeds ${MAX_RIDER_TRIANGLES} triangles`);
  assert(wheelsCombined <= MAX_WHEEL_TRIANGLES, `${label} wheels exceed ${MAX_WHEEL_TRIANGLES} triangles`);
  return { bikeIncludingWheels, rider, wheelsCombined };
}

function collectMetrics(document, nodesByName, label) {
  const root = document.getRoot();
  const nodes = root.listNodes();
  return {
    nodes: nodes.length,
    meshBearingNodes: nodes.filter((node) => node.getMesh()).length,
    meshes: root.listMeshes().length,
    renderPrimitives: nodes.reduce(
      (total, node) => total + (node.getMesh()?.listPrimitives().length ?? 0),
      0,
    ),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    cameras: root.listCameras().length,
    skins: root.listSkins().length,
    animations: root.listAnimations().length,
    triangles: countRenderedTriangles(document),
    trianglesByRegion: collectTriangleBreakdown(document, nodesByName, label),
  };
}

function assertSaneBounds(document, label) {
  const scene = document.getRoot().listScenes()[0];
  assert(scene, `${label} must contain a scene for bounds inspection`);
  const bounds = getBounds(scene);
  const size = bounds.max.map((value, index) => value - bounds.min[index]);
  assert(
    [...bounds.min, ...bounds.max, ...size].every(Number.isFinite),
    `${label} contains non-finite bounds`,
  );
  assert(size[0] >= 0.6 && size[0] <= 2, `${label} rider-right width is outside 0.6-2.0 m`);
  assert(size[1] >= 1.5 && size[1] <= 3.5, `${label} height is outside 1.5-3.5 m`);
  assert(size[2] >= 2 && size[2] <= 4.2, `${label} length is outside 2.0-4.2 m`);
  assert(bounds.min[1] >= -0.01 && bounds.min[1] <= 0.03, `${label} contact plane is not Y=0`);
  return { min: [...bounds.min], max: [...bounds.max], size };
}

function assertBoundsNear(actual, expected, tolerance, label) {
  for (const key of ["min", "max", "size"]) {
    actual[key].forEach((value, index) => {
      assertNear(value, expected[key][index], tolerance, `${label} ${key}[${index}]`);
    });
  }
}

function assertWheelRotationScale(wheel, label) {
  const rotation = wheel.getRotation();
  const scale = wheel.getScale();
  [0, 0, 0, 1].forEach((value, index) => {
    assertNear(rotation[index], value, 1e-7, `${label} local rotation[${index}]`);
  });
  [1, 1, 1].forEach((value, index) => {
    assertNear(scale[index], value, 1e-7, `${label} local scale[${index}]`);
  });
}

function assertMirroredAnchors(left, right, label) {
  assert(left[0] < 0 && right[0] > 0, `${label} must retain rider-left/rider-right X signs`);
  assertNear(Math.abs(left[0]), Math.abs(right[0]), 0.025, `${label} X mirror`);
  assertNear(left[1], right[1], 0.025, `${label} height mirror`);
  assertNear(left[2], right[2], 0.025, `${label} longitudinal mirror`);
}

function assertSpatialContract(nodesByName, label) {
  const frontWheelNode = requiredNode(nodesByName, "FrontTire");
  const rearWheelNode = requiredNode(nodesByName, "RearTire");
  assertWheelRotationScale(frontWheelNode, `${label} FrontTire`);
  assertWheelRotationScale(rearWheelNode, `${label} RearTire`);
  const frontWheel = frontWheelNode.getWorldTranslation();
  const rearWheel = rearWheelNode.getWorldTranslation();
  assertNear(frontWheel[0], 0, 0.001, `${label} front wheel center X`);
  assertNear(rearWheel[0], 0, 0.001, `${label} rear wheel center X`);
  assertNear(frontWheel[1], rearWheel[1], 0.01, `${label} wheel axle heights`);
  assert(frontWheel[2] < rearWheel[2] - 2, `${label} wheelbase must exceed 2 m`);
  assertNear((frontWheel[2] + rearWheel[2]) / 2, 0, 0.01, `${label} wheelbase midpoint`);
  for (const wheelNode of [frontWheelNode, rearWheelNode]) {
    const wheelBounds = getBounds(wheelNode);
    assert(
      [...wheelBounds.min, ...wheelBounds.max].every(Number.isFinite),
      `${label} ${wheelNode.getName()} bounds must be finite`,
    );
    assert(
      wheelBounds.min[1] >= -0.01 && wheelBounds.min[1] <= 0.01,
      `${label} ${wheelNode.getName()} must contact Y=0 within 10 mm`,
    );
  }
  const seatAnchor = requiredNode(nodesByName, "bike-seat-anchor").getWorldTranslation();
  assert(Math.abs(seatAnchor[0]) <= 0.02, `${label} seat anchor must remain centered`);
  assert(seatAnchor[1] > frontWheel[1], `${label} seat anchor must remain above the wheel axles`);
  assert(
    seatAnchor[2] > frontWheel[2] && seatAnchor[2] < rearWheel[2],
    `${label} seat anchor must remain between axles`,
  );
  assertMirroredAnchors(
    requiredNode(nodesByName, "bike-left-hand-anchor").getWorldTranslation(),
    requiredNode(nodesByName, "bike-right-hand-anchor").getWorldTranslation(),
    `${label} hand anchors`,
  );
  assertMirroredAnchors(
    requiredNode(nodesByName, "bike-left-boot-anchor").getWorldTranslation(),
    requiredNode(nodesByName, "bike-right-boot-anchor").getWorldTranslation(),
    `${label} boot anchors`,
  );
}

function captureContractTransforms(nodesByName) {
  return Object.fromEntries(CONTRACT_NODE_NAMES.map((name) => {
    const node = requiredNode(nodesByName, name);
    return [name, {
      parent: node.getParentNode()?.getName() ?? null,
      translation: [...node.getTranslation()],
      rotation: [...node.getRotation()],
      scale: [...node.getScale()],
      hasMesh: node.getMesh() !== null,
    }];
  }));
}

function assertContractTransforms(nodesByName, expected) {
  for (const name of CONTRACT_NODE_NAMES) {
    const node = requiredNode(nodesByName, name);
    const actual = {
      parent: node.getParentNode()?.getName() ?? null,
      translation: [...node.getTranslation()],
      rotation: [...node.getRotation()],
      scale: [...node.getScale()],
      hasMesh: node.getMesh() !== null,
    };
    const contract = expected[name];
    assert(actual.parent === contract.parent, `Optimization changed ${name} parent`);
    assert(actual.hasMesh === contract.hasMesh, `Optimization changed ${name} mesh boundary`);
    for (const key of ["translation", "rotation", "scale"]) {
      assert(
        actual[key].length === contract[key].length
          && actual[key].every((value, index) => Math.abs(value - contract[key][index]) <= 1e-7),
        `Optimization changed ${name} ${key}`,
      );
    }
  }
}

function transformPoint(point, matrix) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const inverseW = w === 0 ? 1 : 1 / w;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * inverseW,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * inverseW,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * inverseW,
  ];
}

function createMomentAccumulator(size) {
  return {
    count: 0,
    min: Array(size).fill(Infinity),
    max: Array(size).fill(-Infinity),
    sum: Array(size).fill(0),
    sumSquares: Array(size).fill(0),
  };
}

function addMoment(accumulator, values) {
  accumulator.count += 1;
  values.forEach((value, index) => {
    assert(Number.isFinite(value), "Decoded hero geometry must contain only finite values");
    accumulator.min[index] = Math.min(accumulator.min[index], value);
    accumulator.max[index] = Math.max(accumulator.max[index], value);
    accumulator.sum[index] += value;
    accumulator.sumSquares[index] += value * value;
  });
}

function finishMoments(accumulator) {
  assert(accumulator.count > 0, "Decoded hero geometry evidence cannot be empty");
  return {
    count: accumulator.count,
    min: accumulator.min,
    max: accumulator.max,
    mean: accumulator.sum.map((value) => value / accumulator.count),
    meanSquare: accumulator.sumSquares.map((value) => value / accumulator.count),
  };
}

function getDrawIndex(indices, index) {
  return indices ? indices.getScalar(index) : index;
}

function captureAttributeEvidence(accessor, indices, semantic, worldMatrix) {
  const drawCount = indices?.getCount() ?? accessor.getCount();
  const size = semantic === "POSITION" ? 3 : accessor.getElementSize();
  const moments = createMomentAccumulator(size);
  const element = [];
  for (let index = 0; index < drawCount; index += 1) {
    accessor.getElement(getDrawIndex(indices, index), element);
    addMoment(moments, semantic === "POSITION" ? transformPoint(element, worldMatrix) : element);
  }
  return {
    semantic,
    accessorCount: accessor.getCount(),
    elementSize: accessor.getElementSize(),
    ...finishMoments(moments),
  };
}

function captureSurfaceEvidence(position, indices, worldMatrix) {
  const drawCount = indices?.getCount() ?? position.getCount();
  assert(drawCount % 3 === 0, "Hero triangle draw count must be divisible by three");
  const triangleAreas = createMomentAccumulator(1);
  const edgeLengths = createMomentAccumulator(1);
  const areaVectors = createMomentAccumulator(3);
  const element = [];
  for (let index = 0; index < drawCount; index += 3) {
    const points = [0, 1, 2].map((offset) => {
      position.getElement(getDrawIndex(indices, index + offset), element);
      return transformPoint(element, worldMatrix);
    });
    const edgeA = points[1].map((value, component) => value - points[0][component]);
    const edgeB = points[2].map((value, component) => value - points[0][component]);
    const cross = [
      edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
      edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
      edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
    ];
    addMoment(triangleAreas, [Math.hypot(...cross) / 2]);
    addMoment(areaVectors, cross.map((value) => value / 2));
    for (const [first, second] of [[0, 1], [1, 2], [2, 0]]) {
      addMoment(edgeLengths, [Math.hypot(
        points[first][0] - points[second][0],
        points[first][1] - points[second][1],
        points[first][2] - points[second][2],
      )]);
    }
  }
  return {
    triangleAreas: finishMoments(triangleAreas),
    edgeLengths: finishMoments(edgeLengths),
    areaVectors: finishMoments(areaVectors),
  };
}

function captureRenderEvidence(document, label) {
  return document.getRoot().listNodes()
    .filter((node) => node.getMesh())
    .sort((first, second) => (first.getName() < second.getName() ? -1 : first.getName() > second.getName() ? 1 : 0))
    .map((node) => {
      const worldMatrix = node.getWorldMatrix();
      const primitives = node.getMesh().listPrimitives().map((primitive) => {
        const indices = primitive.getIndices();
        const semantics = [...primitive.listSemantics()].sort();
        const position = primitive.getAttribute("POSITION");
        assert(position, `${label} ${node.getName()} primitive must contain POSITION`);
        return {
          mode: primitive.getMode(),
          material: primitive.getMaterial()?.getName() ?? null,
          drawCount: indices?.getCount() ?? position.getCount(),
          attributes: semantics.map((semantic) => captureAttributeEvidence(
            primitive.getAttribute(semantic),
            indices,
            semantic,
            worldMatrix,
          )),
          surface: captureSurfaceEvidence(position, indices, worldMatrix),
        };
      });
      return {
        name: node.getName(),
        parent: node.getParentNode()?.getName() ?? null,
        primitives,
      };
    });
}

function assertNumericEvidence(actual, expected, absoluteTolerance, relativeTolerance, label) {
  const tolerance = absoluteTolerance + Math.abs(expected) * relativeTolerance;
  assertNear(actual, expected, tolerance, label);
}

function assertMomentEvidence(actual, expected, tolerance, label) {
  assert(actual.count === expected.count, `${label} sample count changed`);
  for (const key of ["min", "max", "mean", "meanSquare"]) {
    assert(actual[key].length === expected[key].length, `${label} ${key} component count changed`);
    actual[key].forEach((value, index) => {
      assertNumericEvidence(value, expected[key][index], tolerance, tolerance, `${label} ${key}[${index}]`);
    });
  }
}

function assertRenderEvidence(actual, expected, label) {
  assert(actual.length === expected.length, `${label} render-node count changed`);
  actual.forEach((node, nodeIndex) => {
    const expectedNode = expected[nodeIndex];
    assert(node.name === expectedNode.name, `${label} render-node inventory changed`);
    assert(node.parent === expectedNode.parent, `${label} ${node.name} parent changed`);
    assert(node.primitives.length === expectedNode.primitives.length, `${label} ${node.name} primitive count changed`);
    node.primitives.forEach((primitive, primitiveIndex) => {
      const expectedPrimitive = expectedNode.primitives[primitiveIndex];
      const primitiveLabel = `${label} ${node.name} primitive ${primitiveIndex}`;
      assert(primitive.mode === expectedPrimitive.mode, `${primitiveLabel} mode changed`);
      assert(primitive.material === expectedPrimitive.material, `${primitiveLabel} material changed`);
      assert(primitive.drawCount === expectedPrimitive.drawCount, `${primitiveLabel} draw count changed`);
      assert(
        primitive.attributes.length === expectedPrimitive.attributes.length,
        `${primitiveLabel} attribute inventory changed`,
      );
      primitive.attributes.forEach((attribute, attributeIndex) => {
        const expectedAttribute = expectedPrimitive.attributes[attributeIndex];
        const attributeLabel = `${primitiveLabel} ${attribute.semantic}`;
        assert(attribute.semantic === expectedAttribute.semantic, `${primitiveLabel} attribute semantic changed`);
        assert(attribute.accessorCount === expectedAttribute.accessorCount, `${attributeLabel} accessor count changed`);
        assert(attribute.elementSize === expectedAttribute.elementSize, `${attributeLabel} element size changed`);
        const tolerance = attribute.semantic === "NORMAL" || attribute.semantic === "TANGENT" ? 0.02 : 0.003;
        assertMomentEvidence(attribute, expectedAttribute, tolerance, attributeLabel);
      });
      assertMomentEvidence(
        primitive.surface.triangleAreas,
        expectedPrimitive.surface.triangleAreas,
        0.005,
        `${primitiveLabel} triangle areas`,
      );
      assertMomentEvidence(
        primitive.surface.edgeLengths,
        expectedPrimitive.surface.edgeLengths,
        0.005,
        `${primitiveLabel} edge lengths`,
      );
      assertMomentEvidence(
        primitive.surface.areaVectors,
        expectedPrimitive.surface.areaVectors,
        0.005,
        `${primitiveLabel} oriented area`,
      );
    });
  });
}

const [
  sourceBlendBytes,
  sourceGlbBytes,
  sourcePreviewBytes,
  sourcePreviewContactSheetBytes,
  sourceReadmeBytes,
  authoringScriptBytes,
  referenceBytes,
  contractBytes,
  packageBytes,
  optimizerBytes,
  verifierBytes,
  pngIntegrityBytes,
] = await Promise.all([
  readFile(SOURCE_BLEND_PATH),
  readFile(SOURCE_GLB_PATH),
  readFile(SOURCE_PREVIEW_PATH),
  readFile(SOURCE_PREVIEW_CONTACT_SHEET_PATH),
  readFile(SOURCE_README_PATH),
  readFile(AUTHORING_SCRIPT_PATH),
  readFile(REFERENCE_PATH),
  readFile(CONTRACT_PATH),
  readFile(PACKAGE_PATH),
  readFile(OPTIMIZER_PATH),
  readFile(VERIFIER_PATH),
  readFile(PNG_INTEGRITY_PATH),
]);
const basisRuntimeBytes = await Promise.all(
  BASIS_RUNTIME_FILES.map((expected) => readFile(path.join(ROOT, expected.path))),
);
const sourcePreviewPanelBytes = await Promise.all(
  SOURCE_PREVIEW_PANEL_SPECS.map((panel) => readFile(panel.path)),
);
const basisRuntimeRecords = BASIS_RUNTIME_FILES.map((expected, index) => {
  const bytes = basisRuntimeBytes[index];
  assert(bytes.byteLength === expected.bytes, `${expected.path} byte length changed`);
  assert(sha256(bytes) === expected.sha256, `${expected.path} SHA-256 changed`);
  return fileRecord(path.join(ROOT, expected.path), bytes);
});
const preview = inspectPreview(sourcePreviewBytes);
const previewContactSheet = inspectPngIntegrity(
  sourcePreviewContactSheetBytes,
  "Hero source preview contact sheet",
  {
    width: 1280,
    height: 900,
    bitDepth: 8,
    colorType: 6,
  },
);
const previewPanels = SOURCE_PREVIEW_PANEL_SPECS.map((panel, index) => ({
  angle: panel.angle,
  ...inspectPngIntegrity(
    sourcePreviewPanelBytes[index],
    `Hero source preview panel ${panel.angle}`,
    {
      width: 640,
      height: 450,
      bitDepth: 8,
      colorType: 6,
    },
  ),
}));
const reference = inspectPngIntegrity(referenceBytes, "Hero production modeling reference", {
  width: 1672,
  height: 941,
  bitDepth: 8,
  colorType: 2,
});
const packageManifest = JSON.parse(packageBytes.toString("utf8"));
const sourceJson = parseGlbJson(sourceGlbBytes, "Hero source GLB");
assertSerializedRestrictions(sourceJson, "Hero source GLB", { optimized: false });

const sourceIO = new NodeIO().registerExtensions([
  KHRMeshQuantization,
  EXTMeshoptCompression,
]);
const document = await sourceIO.readBinary(sourceGlbBytes);
const authoringScriptSha256 = sha256(authoringScriptBytes);
assert(
  sourceBlendBytes.subarray(0, 12).toString("ascii") === "BLENDER-v405",
  "Hero editable source must be a Blender 4.5 file",
);
assert(
  sourceBlendBytes.includes(Buffer.from(authoringScriptSha256, "ascii")),
  "Hero editable source must bind the current authoring procedure hash",
);
const sourceNodesByName = assertDocumentContract(
  document,
  "Hero source GLB",
  authoringScriptSha256,
);
const sourcePairId = requiredNode(sourceNodesByName, ROOT_NAME).getExtras().source_pair_id;
assert(
  sourceBlendBytes.includes(Buffer.from(sourcePairId, "ascii")),
  "Hero editable source must bind the raw GLB from the same authoring run",
);
const contractTransforms = captureContractTransforms(sourceNodesByName);
const sourceMetrics = collectMetrics(document, sourceNodesByName, "Hero source GLB");
const sourceBounds = assertSaneBounds(document, "Hero source GLB");
const sourceRenderEvidence = captureRenderEvidence(document, "Hero source GLB");
assertSpatialContract(sourceNodesByName, "Hero source GLB");
assert(sourceMetrics.nodes <= MAX_NODES, `Hero source exceeds its ${MAX_NODES}-node budget`);
assert(sourceMetrics.triangles <= MAX_TRIANGLES, `Hero source exceeds its ${MAX_TRIANGLES}-triangle budget`);

await document.transform(
  dedup({
    propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.MATERIAL],
  }),
  join({
    keepNamed: false,
    cleanup: false,
    filter: (node) => !OPTIMIZATION_PRESERVED_NODE_NAME_SET.has(node.getName()),
  }),
  prune({
    keepLeaves: true,
    keepExtras: true,
  }),
);
await MeshoptEncoder.ready;
await document.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));

const productionNodesByName = assertDocumentContract(
  document,
  "Optimized hero GLB",
  authoringScriptSha256,
  sourcePairId,
);
assertContractTransforms(productionNodesByName, contractTransforms);
const productionMetrics = collectMetrics(document, productionNodesByName, "Optimized hero GLB");
const productionBounds = assertSaneBounds(document, "Optimized hero GLB");
const productionRenderEvidence = captureRenderEvidence(document, "Optimized hero GLB");
assertSpatialContract(productionNodesByName, "Optimized hero GLB");
assertBoundsNear(productionBounds, sourceBounds, 0.002, "Optimized/source bounds");
assertRenderEvidence(productionRenderEvidence, sourceRenderEvidence, "Optimized/source render evidence");
assert(
  productionMetrics.triangles === sourceMetrics.triangles,
  "Optimization changed rendered hero triangle coverage",
);
assert(
  productionMetrics.triangles <= MAX_TRIANGLES,
  `Optimized hero exceeds its ${MAX_TRIANGLES}-triangle budget`,
);
assert(productionMetrics.materials <= MAX_MATERIALS, "Optimized hero exceeds its material budget");
assert(
  productionMetrics.meshBearingNodes <= MAX_RUNTIME_MESH_BEARING_NODES,
  `Optimized hero exceeds its ${MAX_RUNTIME_MESH_BEARING_NODES} mesh-bearing-node budget`,
);
assert(
  productionMetrics.renderPrimitives <= MAX_RUNTIME_RENDER_PRIMITIVES,
  `Optimized hero exceeds its ${MAX_RUNTIME_RENDER_PRIMITIVES} render-primitive budget`,
);

const outputIO = new NodeIO()
  .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const outputGlbBytes = await outputIO.writeBinary(document);
assert(outputGlbBytes.byteLength <= MAX_RUNTIME_BYTES, "Optimized hero GLB exceeds its 3 MiB budget");
const outputJson = parseGlbJson(outputGlbBytes, "Optimized hero GLB");
assertSerializedRestrictions(outputJson, "Optimized hero GLB", { optimized: true });
assertOptimizedGeometryEncoding(outputJson, "Optimized hero GLB");
await MeshoptDecoder.ready;
const decodedOutputDocument = await new NodeIO()
  .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder })
  .readBinary(outputGlbBytes);
const decodedOutputNodesByName = assertDocumentContract(
  decodedOutputDocument,
  "Decoded optimized hero GLB",
  authoringScriptSha256,
  sourcePairId,
);
assertContractTransforms(decodedOutputNodesByName, contractTransforms);
const decodedOutputMetrics = collectMetrics(
  decodedOutputDocument,
  decodedOutputNodesByName,
  "Decoded optimized hero GLB",
);
const decodedOutputBounds = assertSaneBounds(decodedOutputDocument, "Decoded optimized hero GLB");
assertSpatialContract(decodedOutputNodesByName, "Decoded optimized hero GLB");
assertBoundsNear(decodedOutputBounds, sourceBounds, 0.002, "Decoded optimized/source bounds");
assertRenderEvidence(
  captureRenderEvidence(decodedOutputDocument, "Decoded optimized hero GLB"),
  sourceRenderEvidence,
  "Decoded optimized/source render evidence",
);
assert(
  JSON.stringify(decodedOutputMetrics) === JSON.stringify(productionMetrics),
  "Serialized optimized hero metrics changed after Meshopt decode",
);

const manifest = {
  schemaVersion: 2,
  generator: "scripts/build-hero-bike-rider-assets.mjs",
  sourcePairId,
  design: {
    name: "RIVET RIDGE RALLY Hero Bike and Rider A",
    origin: "Original project-authored Blender-native geometry and solid-color PBR materials; no source model, texture, downloaded asset, or external resource",
    reference: "docs/design/concepts/hero-bike-rider-production-reference.png",
    referenceOrigin: "Project-specific original modeling reference generated with OpenAI ImageGen from project-owned gameplay concepts; no third-party model or texture was supplied",
    referenceUsage: "Modeling and material guide only; not sampled, projected, or shipped as a runtime texture",
    contract: "docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md",
    authoringProcedure: "art-source/blender/hero-bike-rider/build_hero_bike_rider.py",
    authoringTool: "Blender 4.5.11 LTS",
    coordinateSystem: "1 unit = 1 meter; Blender +X rider-right/+Y forward/+Z up; glTF +X rider-right/+Y up/-Z forward",
    gameplayAuthority: "Presentation only; TypeScript simulation, collision, controls, course, camera, timing, and replay data remain authoritative",
    runtimeMotion: "Code-driven wheel spin and six-pivot rider pose; no skin or baked animation",
    approvedIdentity: "Original coral/teal/cream rivet-ridge language and player number 22 only; no third-party marks or trade dress",
  },
  contract: {
    scene: SCENE_NAME,
    roots: [ROOT_NAME],
    nodes: CONTRACT_NODE_NAMES,
    parentByName: EXPECTED_PARENT_BY_NAME,
    wheelSpinRoots: ["FrontTire", "RearTire"],
    poseHooks: POSE_HOOK_NAMES,
    anchors: ANCHOR_NAMES,
    preservedAtomically: true,
  },
  compression: {
    geometry: "EXT_meshopt_compression (required, high/filter mode)",
    quantization: "KHR_mesh_quantization (required)",
    rawGlbBytes: sourceGlbBytes.byteLength,
    optimizedGlbBytes: outputGlbBytes.byteLength,
    glbReductionPercent: Number(
      ((1 - outputGlbBytes.byteLength / sourceGlbBytes.byteLength) * 100).toFixed(1),
    ),
    textures: "None; solid-color glTF PBR materials only",
  },
  budgets: {
    maximumTriangles: MAX_TRIANGLES,
    maximumBikeTriangles: MAX_BIKE_TRIANGLES,
    maximumRiderTriangles: MAX_RIDER_TRIANGLES,
    maximumWheelTriangles: MAX_WHEEL_TRIANGLES,
    maximumMaterials: MAX_MATERIALS,
    maximumNodes: MAX_NODES,
    maximumRuntimeMeshBearingNodes: MAX_RUNTIME_MESH_BEARING_NODES,
    maximumRuntimeRenderPrimitives: MAX_RUNTIME_RENDER_PRIMITIVES,
    maximumRuntimeBytes: MAX_RUNTIME_BYTES,
  },
  metrics: {
    preview,
    previewContactSheet,
    reference,
    sourceBounds,
    productionBounds: decodedOutputBounds,
    source: sourceMetrics,
    production: decodedOutputMetrics,
    productionMaterials: decodedOutputDocument.getRoot().listMaterials().map((material) => material.getName()),
  },
  dependencies: [
    {
      package: "@gltf-transform/core",
      version: packageManifest.devDependencies["@gltf-transform/core"],
      license: "MIT",
      use: "glTF I/O and structural inspection",
    },
    {
      package: "@gltf-transform/extensions",
      version: packageManifest.devDependencies["@gltf-transform/extensions"],
      license: "MIT",
      use: "Meshopt and quantization extension I/O",
    },
    {
      package: "@gltf-transform/functions",
      version: packageManifest.devDependencies["@gltf-transform/functions"],
      license: "MIT",
      use: "deduplication, draw joining, pruning, and Meshopt transform",
    },
    {
      package: "meshoptimizer",
      version: packageManifest.devDependencies.meshoptimizer,
      license: "MIT",
      use: "build-time geometry encoder and round-trip decoder",
    },
  ],
  pipeline: {
    optimizer: fileRecord(OPTIMIZER_PATH, optimizerBytes),
    independentVerifier: fileRecord(VERIFIER_PATH, verifierBytes),
    pngIntegrityInspector: fileRecord(PNG_INTEGRITY_PATH, pngIntegrityBytes),
    packageManifest: fileRecord(PACKAGE_PATH, packageBytes),
  },
  runtimeSupport: {
    basisTranscoderPath: "/assets/transcoders/basis/",
    usage: "Pinned Three.js KTX2 runtime transcoder distribution; retained for compressed environment assets, while this solid-color hero GLB contains no textures",
    requiredByHeroAsset: false,
    basisFiles: basisRuntimeRecords,
  },
  files: {
    referenceConcept: fileRecord(REFERENCE_PATH, referenceBytes, reference),
    authoringProcedure: fileRecord(AUTHORING_SCRIPT_PATH, authoringScriptBytes),
    sourceReadme: fileRecord(SOURCE_README_PATH, sourceReadmeBytes),
    contract: fileRecord(CONTRACT_PATH, contractBytes),
    editableSource: fileRecord(SOURCE_BLEND_PATH, sourceBlendBytes),
    rawInterchange: fileRecord(SOURCE_GLB_PATH, sourceGlbBytes),
    sourcePreview: fileRecord(SOURCE_PREVIEW_PATH, sourcePreviewBytes, preview),
    sourcePreviewContactSheet: fileRecord(
      SOURCE_PREVIEW_CONTACT_SHEET_PATH,
      sourcePreviewContactSheetBytes,
      previewContactSheet,
    ),
    sourcePreviewPanels: SOURCE_PREVIEW_PANEL_SPECS.map((panel, index) => fileRecord(
      panel.path,
      sourcePreviewPanelBytes[index],
      previewPanels[index],
    )),
    runtime: fileRecord(OUTPUT_GLB_PATH, outputGlbBytes),
  },
};

const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_GLB_PATH, outputGlbBytes);
await writeFile(MANIFEST_PATH, manifestBytes);

console.log(`Generated ${relative(OUTPUT_GLB_PATH)} (${outputGlbBytes.byteLength} bytes)`);
console.log(`Preserved ${CONTRACT_NODE_NAMES.length} public hero nodes and ${productionMetrics.triangles} triangles`);
console.log(`Meshopt GLB reduction: ${sourceGlbBytes.byteLength} -> ${outputGlbBytes.byteLength} bytes`);
console.log(`Generated ${relative(MANIFEST_PATH)} (${manifestBytes.byteLength} bytes)`);
