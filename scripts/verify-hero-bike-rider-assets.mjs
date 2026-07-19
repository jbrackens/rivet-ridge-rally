import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getBounds, NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { validateBytes } from "gltf-validator";
import { MeshoptDecoder } from "meshoptimizer";

import { inspectPngIntegrity } from "./lib/png-integrity.mjs";

const VERIFIER_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(VERIFIER_PATH), "..");
const OPTIMIZER_PATH = path.join(ROOT, "scripts/build-hero-bike-rider-assets.mjs");
const PNG_INTEGRITY_PATH = path.join(ROOT, "scripts/lib/png-integrity.mjs");
const ASSET_DIR = path.join(ROOT, "public/assets/3d");
const MODEL_PATH = path.join(ASSET_DIR, "hero-bike-rider.glb");
const MANIFEST_PATH = path.join(ASSET_DIR, "asset-manifest.json");
const SOURCE_BLEND_PATH = path.join(
  ROOT,
  "art-source/blender/hero-bike-rider/generated/hero-bike-rider-source.blend",
);
const SOURCE_GLB_PATH = path.join(
  ROOT,
  "art-source/blender/hero-bike-rider/generated/hero-bike-rider-raw.glb",
);
const SOURCE_PREVIEW_PATH = path.join(
  ROOT,
  "art-source/blender/hero-bike-rider/generated/hero-bike-rider-preview.png",
);
const SOURCE_PREVIEW_CONTACT_SHEET_PATH = path.join(
  ROOT,
  "art-source/blender/hero-bike-rider/generated/hero-bike-rider-preview-contact-sheet.png",
);
const SOURCE_PREVIEW_PANEL_SPECS = Object.freeze([
  {
    angle: "rear-right",
    path: path.join(ROOT, "art-source/blender/hero-bike-rider/generated/hero-bike-rider-preview-rear-right.png"),
  },
  {
    angle: "right-profile",
    path: path.join(ROOT, "art-source/blender/hero-bike-rider/generated/hero-bike-rider-preview-right-profile.png"),
  },
  {
    angle: "left-profile",
    path: path.join(ROOT, "art-source/blender/hero-bike-rider/generated/hero-bike-rider-preview-left-profile.png"),
  },
  {
    angle: "front-left",
    path: path.join(ROOT, "art-source/blender/hero-bike-rider/generated/hero-bike-rider-preview-front-left.png"),
  },
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

async function readRegularFile(filePath) {
  const details = await lstat(filePath);
  assert.equal(details.isSymbolicLink(), false, `${relative(filePath)} must not be a symlink`);
  assert.equal(details.isFile(), true, `${relative(filePath)} must be a regular file`);
  return readFile(filePath);
}

function parseGlbJson(bytes, label) {
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF", `${label} GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${label} GLB version`);
  assert.equal(bytes.readUInt32LE(8), bytes.byteLength, `${label} declared byte length`);
  assert.equal(bytes.subarray(16, 20).toString("ascii"), "JSON", `${label} JSON chunk`);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/u, ""));
}

function assertSerializedRestrictions(json, label, { optimized }) {
  assert.equal((json.scenes ?? []).length, 1, `${label} scene count`);
  assert.equal(json.scenes[0]?.name, SCENE_NAME, `${label} scene name`);
  assert.equal((json.images ?? []).length, 0, `${label} image count`);
  assert.equal((json.textures ?? []).length, 0, `${label} texture count`);
  assert.equal((json.samplers ?? []).length, 0, `${label} texture-sampler count`);
  assert.equal((json.cameras ?? []).length, 0, `${label} camera count`);
  assert.equal((json.skins ?? []).length, 0, `${label} skin count`);
  assert.equal((json.animations ?? []).length, 0, `${label} animation count`);
  assert.equal((json.extensionsUsed ?? []).includes("KHR_lights_punctual"), false, `${label} light use`);
  assert.equal(json.extensions?.KHR_lights_punctual, undefined, `${label} must not contain lights`);
  const expectedExtensions = optimized
    ? ["EXT_meshopt_compression", "KHR_mesh_quantization"].sort()
    : [];
  assert.deepEqual([...(json.extensionsUsed ?? [])].sort(), expectedExtensions, `${label} used extensions`);
  assert.deepEqual(
    [...(json.extensionsRequired ?? [])].sort(),
    expectedExtensions,
    `${label} required extensions`,
  );
  const buffers = json.buffers ?? [];
  if (optimized) {
    assert.equal(buffers.length, 2, `${label} payload/fallback buffer count`);
    assert.equal(buffers[0]?.uri, undefined, `${label} payload buffer URI`);
    assert.equal(buffers[0]?.extensions, undefined, `${label} payload buffer extensions`);
    assert.equal(buffers[1]?.uri, undefined, `${label} fallback buffer URI`);
    assert.deepEqual(
      buffers[1]?.extensions,
      { EXT_meshopt_compression: { fallback: true } },
      `${label} fallback buffer declaration`,
    );
  } else {
    assert.equal(buffers.length, 1, `${label} embedded-buffer count`);
    assert.equal(buffers[0]?.uri, undefined, `${label} buffer must be embedded`);
  }
  const names = (json.nodes ?? []).map((node) => node.name ?? "");
  assert(names.every(Boolean), `${label} must name every node`);
  assert.equal(new Set(names).size, names.length, `${label} node names must be unique`);
  assert.deepEqual(
    (json.scenes[0]?.nodes ?? []).map((index) => names[index]),
    [ROOT_NAME],
    `${label} root list`,
  );
}

function assertOptimizedGeometryEncoding(json, label) {
  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];
  const geometryAccessors = [];
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      assert(Number.isInteger(primitive.indices), `${label} primitives must use indexed geometry`);
      assert.equal((primitive.targets ?? []).length, 0, `${label} morph-target count`);
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
    assert.equal(accessor.sparse, undefined, `${label} ${semantic} sparse accessor`);
    assert(Number.isInteger(accessor.bufferView), `${label} ${semantic} must use a bufferView`);
    const bufferView = bufferViews[accessor.bufferView];
    const meshoptExtension = bufferView?.extensions?.EXT_meshopt_compression;
    assert(meshoptExtension, `${label} ${semantic} bufferView must use EXT_meshopt_compression`);
    assert.equal(bufferView.buffer, 1, `${label} ${semantic} fallback buffer index`);
    assert.equal(meshoptExtension.buffer, 0, `${label} ${semantic} payload buffer index`);
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
      assert.equal(meshoptExtension.mode, "ATTRIBUTES", `${label} ${semantic} Meshopt mode`);
    }
    if (semantic === "POSITION") {
      assert.equal(accessor.type, "VEC3", `${label} POSITION accessor type`);
      assert.equal(accessor.componentType, 5122, `${label} POSITION quantized component type`);
      assert.equal(accessor.normalized, true, `${label} POSITION normalized quantization`);
    }
    if (semantic === "NORMAL") {
      assert.equal(accessor.type, "VEC3", `${label} NORMAL accessor type`);
      assert.equal(accessor.componentType, 5120, `${label} high/filter Meshopt normal component type`);
      assert.equal(accessor.normalized, true, `${label} high/filter Meshopt normal normalization`);
      assert.equal(meshoptExtension.filter, "OCTAHEDRAL", `${label} NORMAL Meshopt filter`);
    }
    if (semantic === "TANGENT") {
      assert.equal(accessor.type, "VEC4", `${label} TANGENT accessor type`);
      assert.equal(accessor.componentType, 5120, `${label} high/filter Meshopt tangent component type`);
      assert.equal(accessor.normalized, true, `${label} high/filter Meshopt tangent normalization`);
      assert.equal(meshoptExtension.filter, "OCTAHEDRAL", `${label} TANGENT Meshopt filter`);
    }
    if (semantic.startsWith("TEXCOORD_")) {
      assert.equal(accessor.type, "VEC2", `${label} ${semantic} accessor type`);
      assert.equal(accessor.componentType, 5123, `${label} ${semantic} quantized component type`);
      assert.equal(accessor.normalized, true, `${label} ${semantic} normalized quantization`);
    }
    if (semantic.startsWith("COLOR_")) {
      assert.equal(accessor.componentType, 5121, `${label} ${semantic} quantized component type`);
      assert.equal(accessor.normalized, true, `${label} ${semantic} normalized quantization`);
    }
  }
}

function indexNodes(document, label) {
  const nodes = document.getRoot().listNodes();
  const nodesByName = new Map(nodes.map((node) => [node.getName(), node]));
  assert.equal(nodesByName.size, nodes.length, `${label} node names must be unique`);
  assert(
    nodes.every((node) => node.getName() && !/\.\d{3}$/u.test(node.getName())),
    `${label} must use stable semantic node names`,
  );
  return nodesByName;
}

function requiredNode(nodesByName, name) {
  const node = nodesByName.get(name);
  assert(node, `Hero asset is missing required node ${name}`);
  return node;
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
  assert.deepEqual(
    [...names].sort(),
    [...REQUIRED_MATERIAL_NAMES].sort(),
    `${label} exact semantic material inventory`,
  );
  for (const material of materials) {
    const name = material.getName();
    const contract = MATERIAL_CONTRACT[name];
    assert(contract, `${label} contains unapproved material ${name}`);
    assertFactorRange(material.getRoughnessFactor(), contract.roughness, `${label} ${name} roughness`);
    assertFactorRange(material.getMetallicFactor(), contract.metallic, `${label} ${name} metallic`);
    assert.equal(material.getAlphaMode(), "OPAQUE", `${label} ${name} alpha mode`);
    const baseColor = material.getBaseColorFactor();
    assert.equal(baseColor.length, 4, `${label} ${name} base-color component count`);
    assert(
      baseColor.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
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
    assert.equal(node.getParentNode()?.getName(), binding.parent, `${label} ${binding.node} parent`);
    const primitives = node.getMesh()?.listPrimitives() ?? [];
    assert.equal(primitives.length, 1, `${label} ${binding.node} primitive count`);
    assert.equal(
      primitives[0].getMaterial()?.getName(),
      binding.material,
      `${label} ${binding.node} semantic material`,
    );
  }
}

function assertIdentity(node, label = node.getName()) {
  assert.deepEqual(node.getTranslation(), [0, 0, 0], `${label} translation`);
  assert.deepEqual(node.getRotation(), [0, 0, 0, 1], `${label} rotation`);
  assert.deepEqual(node.getScale(), [1, 1, 1], `${label} scale`);
}

function assertHierarchy(
  document,
  label,
  authoringScriptSha256,
  expectedSourcePairId = null,
) {
  const root = document.getRoot();
  const scenes = root.listScenes();
  assert.equal(scenes.length, 1, `${label} scene count`);
  assert.equal(scenes[0]?.getName(), SCENE_NAME, `${label} scene name`);
  assert.deepEqual(scenes[0]?.listChildren().map((node) => node.getName()), [ROOT_NAME], `${label} roots`);
  const nodesByName = indexNodes(document, label);
  for (const [name, expectedParent] of Object.entries(EXPECTED_PARENT_BY_NAME)) {
    assert.equal(
      requiredNode(nodesByName, name).getParentNode()?.getName() ?? null,
      expectedParent,
      `${label} parent for ${name}`,
    );
  }
  assertIdentity(requiredNode(nodesByName, ROOT_NAME));
  assertIdentity(requiredNode(nodesByName, "RRR_BikeVisual"));
  assertIdentity(requiredNode(nodesByName, "player-rider"));
  const rootExtras = requiredNode(nodesByName, ROOT_NAME).getExtras();
  assert.equal(rootExtras.asset_root, true, `${label} root provenance marker`);
  assert.equal(
    rootExtras.asset_source,
    "Original project-authored Blender-native geometry",
    `${label} source provenance`,
  );
  assert.equal(
    rootExtras.authoring_script_sha256,
    authoringScriptSha256,
    `${label} authoring-procedure binding`,
  );
  assert.equal(rootExtras.authoring_blender_version, "4.5.11 LTS", `${label} Blender version`);
  assert.equal(rootExtras.source_schema, "rrr-hero-bike-rider-v1", `${label} source schema`);
  assert(
    typeof rootExtras.source_pair_id === "string" && UUID_V4_PATTERN.test(rootExtras.source_pair_id),
    `${label} source-pair identifier must be UUIDv4`,
  );
  if (expectedSourcePairId !== null) {
    assert.equal(rootExtras.source_pair_id, expectedSourcePairId, `${label} source-pair binding`);
  }
  assertMaterialContract(document, label);
  assertSemanticMaterialBindings(nodesByName, label);
  return nodesByName;
}

function countRenderedTrianglesForNodes(nodes) {
  let triangles = 0;
  for (const node of nodes) {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      assert.equal(primitive.getMode(), 4, `${node.getName()} primitive mode`);
      const count = primitive.getIndices()?.getCount()
        ?? primitive.getAttribute("POSITION")?.getCount()
        ?? 0;
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
  assert.equal(total, countRenderedTriangles(document), `${label} document triangle accounting`);
  assert.equal(total, bikeIncludingWheels + rider, `${label} bike/rider triangle accounting`);
  assert(bikeIncludingWheels <= MAX_BIKE_TRIANGLES, `${label} bike triangle budget`);
  assert(rider <= MAX_RIDER_TRIANGLES, `${label} rider triangle budget`);
  assert(wheelsCombined <= MAX_WHEEL_TRIANGLES, `${label} wheel triangle budget`);
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
  const actual = captureContractTransforms(nodesByName);
  for (const name of CONTRACT_NODE_NAMES) {
    assert.equal(actual[name].parent, expected[name].parent, `Optimization changed ${name} parent`);
    assert.equal(actual[name].hasMesh, expected[name].hasMesh, `Optimization changed ${name} mesh boundary`);
    for (const key of ["translation", "rotation", "scale"]) {
      assert.equal(actual[name][key].length, expected[name][key].length, `${name} ${key} length`);
      actual[name][key].forEach((value, index) => {
        assertNear(value, expected[name][key][index], 1e-7, `${name} ${key}[${index}]`);
      });
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
  assert.equal(drawCount % 3, 0, "Hero triangle draw count must be divisible by three");
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
  assert.equal(actual.count, expected.count, `${label} sample count`);
  for (const key of ["min", "max", "mean", "meanSquare"]) {
    assert.equal(actual[key].length, expected[key].length, `${label} ${key} component count`);
    actual[key].forEach((value, index) => {
      assertNumericEvidence(value, expected[key][index], tolerance, tolerance, `${label} ${key}[${index}]`);
    });
  }
}

function assertRenderEvidence(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} render-node count`);
  actual.forEach((node, nodeIndex) => {
    const expectedNode = expected[nodeIndex];
    assert.equal(node.name, expectedNode.name, `${label} render-node inventory`);
    assert.equal(node.parent, expectedNode.parent, `${label} ${node.name} parent`);
    assert.equal(node.primitives.length, expectedNode.primitives.length, `${label} ${node.name} primitive count`);
    node.primitives.forEach((primitive, primitiveIndex) => {
      const expectedPrimitive = expectedNode.primitives[primitiveIndex];
      const primitiveLabel = `${label} ${node.name} primitive ${primitiveIndex}`;
      assert.equal(primitive.mode, expectedPrimitive.mode, `${primitiveLabel} mode`);
      assert.equal(primitive.material, expectedPrimitive.material, `${primitiveLabel} material`);
      assert.equal(primitive.drawCount, expectedPrimitive.drawCount, `${primitiveLabel} draw count`);
      assert.equal(
        primitive.attributes.length,
        expectedPrimitive.attributes.length,
        `${primitiveLabel} attribute inventory`,
      );
      primitive.attributes.forEach((attribute, attributeIndex) => {
        const expectedAttribute = expectedPrimitive.attributes[attributeIndex];
        const attributeLabel = `${primitiveLabel} ${attribute.semantic}`;
        assert.equal(attribute.semantic, expectedAttribute.semantic, `${primitiveLabel} attribute semantic`);
        assert.equal(attribute.accessorCount, expectedAttribute.accessorCount, `${attributeLabel} accessor count`);
        assert.equal(attribute.elementSize, expectedAttribute.elementSize, `${attributeLabel} element size`);
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

function assertNear(first, second, tolerance, label) {
  assert(Math.abs(first - second) <= tolerance, `${label}: expected ${second}, received ${first}`);
}

function assertMirroredAnchors(left, right, label) {
  assert(left[0] < 0 && right[0] > 0, `${label} must retain rider-left/rider-right X signs`);
  assertNear(Math.abs(left[0]), Math.abs(right[0]), 0.025, `${label} X mirror`);
  assertNear(left[1], right[1], 0.025, `${label} height mirror`);
  assertNear(left[2], right[2], 0.025, `${label} longitudinal mirror`);
}

function assertSaneBounds(document, label) {
  const scene = document.getRoot().listScenes()[0];
  assert(scene, `${label} scene for bounds inspection`);
  const bounds = getBounds(scene);
  const size = bounds.max.map((value, index) => value - bounds.min[index]);
  assert([...bounds.min, ...bounds.max, ...size].every(Number.isFinite), `${label} finite bounds`);
  assert(size[0] >= 0.6 && size[0] <= 2, `${label} width sanity`);
  assert(size[1] >= 1.5 && size[1] <= 3.5, `${label} height sanity`);
  assert(size[2] >= 2 && size[2] <= 4.2, `${label} length sanity`);
  assert(bounds.min[1] >= -0.01 && bounds.min[1] <= 0.03, `${label} tire contact plane`);
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
      `${label} ${wheelNode.getName()} finite bounds`,
    );
    assert(
      wheelBounds.min[1] >= -0.01 && wheelBounds.min[1] <= 0.01,
      `${label} ${wheelNode.getName()} must contact Y=0 within 10 mm`,
    );
  }
  const seatAnchor = requiredNode(nodesByName, "bike-seat-anchor").getWorldTranslation();
  assert(Math.abs(seatAnchor[0]) <= 0.02, `${label} centered seat anchor`);
  assert(seatAnchor[1] > frontWheel[1], `${label} seat anchor above axles`);
  assert(
    seatAnchor[2] > frontWheel[2] && seatAnchor[2] < rearWheel[2],
    `${label} seat anchor between axles`,
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

function manifestFileRecord(expectedPath, bytes, extra = {}) {
  return {
    path: expectedPath,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    ...extra,
  };
}

function assertManifestFile(record, expectedPath, bytes, extra = {}) {
  assert.deepEqual(record, manifestFileRecord(expectedPath, bytes, extra), `${expectedPath} manifest record`);
}

assert.deepEqual(
  (await readdir(ASSET_DIR)).sort(),
  ["asset-manifest.json", "hero-bike-rider.glb"],
  "public/assets/3d must contain only the authoritative hero runtime and manifest",
);
assert.deepEqual(
  (await readdir(path.join(ROOT, "public/assets/transcoders/basis"))).sort(),
  ["LICENSE.txt", "NOTICE.txt", "README.md", "basis_transcoder.js", "basis_transcoder.wasm"],
  "Basis runtime directory must contain only its pinned distribution files",
);

const [
  modelBytes,
  manifestBytes,
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
  readRegularFile(MODEL_PATH),
  readRegularFile(MANIFEST_PATH),
  readRegularFile(SOURCE_BLEND_PATH),
  readRegularFile(SOURCE_GLB_PATH),
  readRegularFile(SOURCE_PREVIEW_PATH),
  readRegularFile(SOURCE_PREVIEW_CONTACT_SHEET_PATH),
  readRegularFile(SOURCE_README_PATH),
  readRegularFile(AUTHORING_SCRIPT_PATH),
  readRegularFile(REFERENCE_PATH),
  readRegularFile(CONTRACT_PATH),
  readRegularFile(PACKAGE_PATH),
  readRegularFile(OPTIMIZER_PATH),
  readRegularFile(VERIFIER_PATH),
  readRegularFile(PNG_INTEGRITY_PATH),
]);
const basisRuntimeBytes = await Promise.all(
  BASIS_RUNTIME_FILES.map((expected) => readRegularFile(path.join(ROOT, expected.path))),
);
const sourcePreviewPanelBytes = await Promise.all(
  SOURCE_PREVIEW_PANEL_SPECS.map((panel) => readRegularFile(panel.path)),
);

const authoringScriptSha256 = sha256(authoringScriptBytes);
assert.equal(
  sourceBlendBytes.subarray(0, 12).toString("ascii"),
  "BLENDER-v405",
  "Editable Blender 4.5 signature",
);
assert(
  sourceBlendBytes.includes(Buffer.from(authoringScriptSha256, "ascii")),
  "Editable Blender source must bind the current authoring procedure hash",
);
const preview = inspectPngIntegrity(sourcePreviewBytes, "Hero source preview", {
  width: 1_280,
  height: 900,
  bitDepth: 8,
  colorType: 6,
});
assert.deepEqual(preview, {
  width: 1_280,
  height: 900,
  bitDepth: 8,
  colorType: 6,
});
const previewContactSheet = inspectPngIntegrity(
  sourcePreviewContactSheetBytes,
  "Hero source preview contact sheet",
  {
    width: 1_280,
    height: 900,
    bitDepth: 8,
    colorType: 6,
  },
);
assert.deepEqual(previewContactSheet, {
  width: 1_280,
  height: 900,
  bitDepth: 8,
  colorType: 6,
});
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
const reference = inspectPngIntegrity(referenceBytes, "Hero production reference", {
  width: 1_672,
  height: 941,
  bitDepth: 8,
  colorType: 2,
});
assert.deepEqual(reference, {
  width: 1_672,
  height: 941,
  bitDepth: 8,
  colorType: 2,
});

const manifest = JSON.parse(manifestBytes.toString("utf8"));
const packageManifest = JSON.parse(packageBytes.toString("utf8"));
assert.deepEqual(Object.keys(manifest).sort(), [
  "budgets",
  "compression",
  "contract",
  "dependencies",
  "design",
  "files",
  "generator",
  "metrics",
  "pipeline",
  "runtimeSupport",
  "schemaVersion",
  "sourcePairId",
]);
assert.equal(manifest.schemaVersion, 2, "Hero manifest schema");
assert.equal(manifest.generator, "scripts/build-hero-bike-rider-assets.mjs", "Hero manifest generator");
assert(UUID_V4_PATTERN.test(manifest.sourcePairId), "Hero manifest source-pair identifier");
assert(
  sourceBlendBytes.includes(Buffer.from(manifest.sourcePairId, "ascii")),
  "Editable Blender source must bind the manifest source pair",
);
assert.deepEqual(manifest.design, {
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
});
assert.deepEqual(manifest.contract, {
  scene: SCENE_NAME,
  roots: [ROOT_NAME],
  nodes: CONTRACT_NODE_NAMES,
  parentByName: EXPECTED_PARENT_BY_NAME,
  wheelSpinRoots: ["FrontTire", "RearTire"],
  poseHooks: POSE_HOOK_NAMES,
  anchors: ANCHOR_NAMES,
  preservedAtomically: true,
});
assert.deepEqual(manifest.budgets, {
  maximumTriangles: MAX_TRIANGLES,
  maximumBikeTriangles: MAX_BIKE_TRIANGLES,
  maximumRiderTriangles: MAX_RIDER_TRIANGLES,
  maximumWheelTriangles: MAX_WHEEL_TRIANGLES,
  maximumMaterials: MAX_MATERIALS,
  maximumNodes: MAX_NODES,
  maximumRuntimeMeshBearingNodes: MAX_RUNTIME_MESH_BEARING_NODES,
  maximumRuntimeRenderPrimitives: MAX_RUNTIME_RENDER_PRIMITIVES,
  maximumRuntimeBytes: MAX_RUNTIME_BYTES,
});
assert.deepEqual(manifest.compression, {
  geometry: "EXT_meshopt_compression (required, high/filter mode)",
  quantization: "KHR_mesh_quantization (required)",
  rawGlbBytes: sourceGlbBytes.byteLength,
  optimizedGlbBytes: modelBytes.byteLength,
  glbReductionPercent: Number(
    ((1 - modelBytes.byteLength / sourceGlbBytes.byteLength) * 100).toFixed(1),
  ),
  textures: "None; solid-color glTF PBR materials only",
});
assert.deepEqual(Object.keys(manifest.metrics).sort(), [
  "preview",
  "previewContactSheet",
  "production",
  "productionBounds",
  "productionMaterials",
  "reference",
  "source",
  "sourceBounds",
]);
assert.deepEqual(manifest.metrics.preview, preview, "Hero manifest preview metrics");
assert.deepEqual(
  manifest.metrics.previewContactSheet,
  previewContactSheet,
  "Hero manifest preview contact-sheet metrics",
);
assert.deepEqual(manifest.metrics.reference, reference, "Hero manifest reference metrics");

assert.deepEqual(Object.keys(manifest.files).sort(), [
  "authoringProcedure",
  "contract",
  "editableSource",
  "rawInterchange",
  "referenceConcept",
  "runtime",
  "sourcePreview",
  "sourcePreviewContactSheet",
  "sourcePreviewPanels",
  "sourceReadme",
]);
assertManifestFile(manifest.files.referenceConcept, relative(REFERENCE_PATH), referenceBytes, reference);
assertManifestFile(manifest.files.authoringProcedure, relative(AUTHORING_SCRIPT_PATH), authoringScriptBytes);
assertManifestFile(manifest.files.sourceReadme, relative(SOURCE_README_PATH), sourceReadmeBytes);
assertManifestFile(manifest.files.contract, relative(CONTRACT_PATH), contractBytes);
assertManifestFile(manifest.files.editableSource, relative(SOURCE_BLEND_PATH), sourceBlendBytes);
assertManifestFile(manifest.files.rawInterchange, relative(SOURCE_GLB_PATH), sourceGlbBytes);
assertManifestFile(manifest.files.sourcePreview, relative(SOURCE_PREVIEW_PATH), sourcePreviewBytes, preview);
assertManifestFile(
  manifest.files.sourcePreviewContactSheet,
  relative(SOURCE_PREVIEW_CONTACT_SHEET_PATH),
  sourcePreviewContactSheetBytes,
  previewContactSheet,
);
assert.deepEqual(
  manifest.files.sourcePreviewPanels,
  SOURCE_PREVIEW_PANEL_SPECS.map((panel, index) => manifestFileRecord(
    relative(panel.path),
    sourcePreviewPanelBytes[index],
    previewPanels[index],
  )),
  "Hero source preview panel manifest records",
);
assertManifestFile(manifest.files.runtime, relative(MODEL_PATH), modelBytes);
assert(modelBytes.byteLength <= MAX_RUNTIME_BYTES, "Hero runtime GLB exceeds 3 MiB");

assert.deepEqual(manifest.dependencies, [
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
], "Hero manifest dependencies");

assert.deepEqual(Object.keys(manifest.pipeline).sort(), [
  "independentVerifier",
  "optimizer",
  "packageManifest",
  "pngIntegrityInspector",
]);
assertManifestFile(manifest.pipeline.optimizer, relative(OPTIMIZER_PATH), optimizerBytes);
assertManifestFile(manifest.pipeline.independentVerifier, relative(VERIFIER_PATH), verifierBytes);
assertManifestFile(manifest.pipeline.pngIntegrityInspector, relative(PNG_INTEGRITY_PATH), pngIntegrityBytes);
assertManifestFile(manifest.pipeline.packageManifest, relative(PACKAGE_PATH), packageBytes);

const basisRuntimeRecords = BASIS_RUNTIME_FILES.map((expected, index) => {
  const bytes = basisRuntimeBytes[index];
  assert.equal(bytes.byteLength, expected.bytes, `${expected.path} byte length`);
  assert.equal(sha256(bytes), expected.sha256, `${expected.path} SHA-256`);
  return manifestFileRecord(expected.path, bytes);
});
assert.deepEqual(manifest.runtimeSupport, {
  basisTranscoderPath: "/assets/transcoders/basis/",
  usage: "Pinned Three.js KTX2 runtime transcoder distribution; retained for compressed environment assets, while this solid-color hero GLB contains no textures",
  requiredByHeroAsset: false,
  basisFiles: basisRuntimeRecords,
});

const sourceJson = parseGlbJson(sourceGlbBytes, "Hero source");
const productionJson = parseGlbJson(modelBytes, "Hero production");
assertSerializedRestrictions(sourceJson, "Hero source", { optimized: false });
assertSerializedRestrictions(productionJson, "Hero production", { optimized: true });
assertOptimizedGeometryEncoding(productionJson, "Hero production");

const sourceDocument = await new NodeIO()
  .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
  .readBinary(sourceGlbBytes);
const sourceNodesByName = assertHierarchy(
  sourceDocument,
  "Hero source",
  authoringScriptSha256,
  manifest.sourcePairId,
);
const sourceTransforms = captureContractTransforms(sourceNodesByName);
const sourceMetrics = collectMetrics(sourceDocument, sourceNodesByName, "Hero source");
const sourceBounds = assertSaneBounds(sourceDocument, "Hero source");
const sourceRenderEvidence = captureRenderEvidence(sourceDocument, "Hero source");
assertSpatialContract(sourceNodesByName, "Hero source");
assert.deepEqual(sourceMetrics, manifest.metrics.source, "Hero source metrics");
assertBoundsNear(sourceBounds, manifest.metrics.sourceBounds, 0.002, "Hero source manifest bounds");
assert(sourceMetrics.nodes <= MAX_NODES, "Hero source node budget");
assert(sourceMetrics.triangles <= MAX_TRIANGLES, "Hero source triangle budget");

await MeshoptDecoder.ready;
const productionDocument = await new NodeIO()
  .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder })
  .readBinary(modelBytes);
const productionNodesByName = assertHierarchy(
  productionDocument,
  "Hero production",
  authoringScriptSha256,
  manifest.sourcePairId,
);
assertContractTransforms(productionNodesByName, sourceTransforms);
const productionMetrics = collectMetrics(productionDocument, productionNodesByName, "Hero production");
const productionBounds = assertSaneBounds(productionDocument, "Hero production");
const productionRenderEvidence = captureRenderEvidence(productionDocument, "Hero production");
assertSpatialContract(productionNodesByName, "Hero production");
assertBoundsNear(productionBounds, sourceBounds, 0.002, "Hero production/source bounds");
assertRenderEvidence(productionRenderEvidence, sourceRenderEvidence, "Hero production/source render evidence");
assert.deepEqual(productionMetrics, manifest.metrics.production, "Hero production metrics");
assert.equal(productionMetrics.triangles, sourceMetrics.triangles, "Optimization triangle coverage");
assert(productionMetrics.nodes <= MAX_NODES, "Hero production node budget");
assert(productionMetrics.meshBearingNodes <= MAX_RUNTIME_MESH_BEARING_NODES, "Hero mesh-bearing-node budget");
assert(productionMetrics.renderPrimitives <= MAX_RUNTIME_RENDER_PRIMITIVES, "Hero render-primitive budget");
assert(productionMetrics.materials <= MAX_MATERIALS, "Hero material budget");
assert(productionMetrics.triangles <= MAX_TRIANGLES, "Hero triangle budget");
assert.equal(productionMetrics.textures, 0, "Hero texture count");
assert.equal(productionMetrics.cameras, 0, "Hero camera count");
assert.equal(productionMetrics.skins, 0, "Hero skin count");
assert.equal(productionMetrics.animations, 0, "Hero animation count");

const materialNames = productionDocument.getRoot().listMaterials().map((material) => material.getName());
assert.deepEqual(materialNames, manifest.metrics.productionMaterials, "Hero production material inventory");
assert.deepEqual([...materialNames].sort(), [...REQUIRED_MATERIAL_NAMES].sort(), "Hero exact material inventory");

const heroRoot = requiredNode(productionNodesByName, ROOT_NAME);
const rootExtras = heroRoot.getExtras();
assert.equal(rootExtras.asset_root, true);
assert.equal(rootExtras.gameplay_authority, "presentation-only");
assert.equal(rootExtras.reference, "docs/design/concepts/hero-bike-rider-production-reference.png");
assert.equal(rootExtras.contract, "docs/design/HERO_BIKE_RIDER_VERTICAL_SLICE.md");
for (const wheelName of ["FrontTire", "RearTire"]) {
  assert.equal(requiredNode(productionNodesByName, wheelName).getExtras().animated_axis, "+X");
}

assertBoundsNear(
  productionBounds,
  manifest.metrics.productionBounds,
  0.002,
  "Hero production manifest bounds",
);

const validation = await validateBytes(new Uint8Array(modelBytes), {
  uri: "hero-bike-rider.glb",
  maxIssues: 100,
  externalResourceFunction: async () => {
    throw new Error("Hero GLB must not request an external resource");
  },
});
assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues.messages, null, 2));

console.log(
  `Verified hero bike/rider: ${productionMetrics.triangles.toLocaleString()} triangles, `
    + `${productionMetrics.meshBearingNodes} mesh-bearing nodes, `
    + `${productionMetrics.renderPrimitives} render primitives, `
    + `${modelBytes.byteLength.toLocaleString()} bytes.`,
);
