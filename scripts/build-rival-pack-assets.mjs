import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO, PropertyType } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { dedup, meshopt, prune } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

import { inspectPngIntegrity } from "./lib/png-integrity.mjs";

const BUILDER_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(BUILDER_PATH), "..");
const VERIFIER_PATH = path.join(ROOT, "scripts/verify-rival-pack-assets.mjs");
const PNG_INTEGRITY_PATH = path.join(ROOT, "scripts/lib/png-integrity.mjs");
const SOURCE_DIR = path.join(ROOT, "art-source/blender/rival-pack/generated");
const SOURCE_BLEND_PATH = path.join(SOURCE_DIR, "rival-pack-source.blend");
const SOURCE_GLB_PATH = path.join(SOURCE_DIR, "rival-pack-raw.glb");
const SOURCE_PREVIEW_PATH = path.join(SOURCE_DIR, "rival-pack-preview.png");
const SOURCE_CONTACT_SHEET_PATH = path.join(SOURCE_DIR, "rival-pack-variants-contact-sheet.png");
const SOURCE_README_PATH = path.join(ROOT, "art-source/blender/rival-pack/README.md");
const AUTHORING_SCRIPT_PATH = path.join(ROOT, "art-source/blender/rival-pack/build_rival_pack.py");
const CONTRACT_PATH = path.join(ROOT, "docs/design/RIVAL_PACK_VERTICAL_SLICE.md");
const PACKAGE_PATH = path.join(ROOT, "package.json");
const OUTPUT_DIR = path.join(ROOT, "public/assets/rivals");
const OUTPUT_GLB_PATH = path.join(OUTPUT_DIR, "rival-pack.glb");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "asset-manifest.json");

const SCENE_NAME = "RRR_RivalPackScene";
const ROOT_NAME = "RRR_RivalPackBase";
const VARIANT_NUMBERS = Object.freeze(["17", "31", "46", "58", "73"]);
const PARENT_BY_NAME = Object.freeze({
  RRR_RivalPackBase: null,
  RRR_RivalBikeVisual: ROOT_NAME,
  BikeStatic_Primary: "RRR_RivalBikeVisual",
  BikeStatic_Accent: "RRR_RivalBikeVisual",
  BikeStatic_Hardware: "RRR_RivalBikeVisual",
  BikeStatic_NumberField: "RRR_RivalBikeVisual",
  "bike-steering-pivot": "RRR_RivalBikeVisual",
  "bike-front-suspension-pivot": "bike-steering-pivot",
  FrontTire: "bike-front-suspension-pivot",
  FrontWheel_Wheel: "FrontTire",
  "bike-rear-suspension-pivot": "RRR_RivalBikeVisual",
  RearTire: "bike-rear-suspension-pivot",
  RearWheel_Wheel: "RearTire",
  "rival-rider": ROOT_NAME,
  "rider-torso-pivot": "rival-rider",
  RivalTorso_Primary: "rider-torso-pivot",
  "rider-head-pivot": "rider-torso-pivot",
  RivalHead_Accent: "rider-head-pivot",
  "rider-left-arm-pivot": "rider-torso-pivot",
  RivalLeftArm_Accent: "rider-left-arm-pivot",
  "rider-right-arm-pivot": "rider-torso-pivot",
  RivalRightArm_Accent: "rider-right-arm-pivot",
  "rider-left-leg-pivot": "rival-rider",
  RivalLeftLeg_Primary: "rider-left-leg-pivot",
  "rider-right-leg-pivot": "rival-rider",
  RivalRightLeg_Primary: "rider-right-leg-pivot",
});
const REQUIRED_NODE_NAMES = Object.freeze(Object.keys(PARENT_BY_NAME));
const MATERIAL_NAMES = Object.freeze([
  "RRR_RivalPrimary",
  "RRR_RivalAccent",
  "RRR_RivalHardware",
  "RRR_RivalWheel",
  "RRR_RivalNumberField",
]);
const MAX_RUNTIME_BYTES = 2 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function fileRecord(filePath, bytes) {
  return {
    path: relative(filePath),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function assertIdentity(node, label) {
  assert(node.getTranslation().every((value) => Math.abs(value) <= 1e-7), `${label} translation`);
  const rotation = node.getRotation();
  assert(
    Math.abs(rotation[0]) <= 1e-7
      && Math.abs(rotation[1]) <= 1e-7
      && Math.abs(rotation[2]) <= 1e-7
      && Math.abs(rotation[3] - 1) <= 1e-7,
    `${label} rotation`,
  );
  assert(node.getScale().every((value) => Math.abs(value - 1) <= 1e-7), `${label} scale`);
}

function collectMetrics(document) {
  const root = document.getRoot();
  const meshNodes = root.listNodes().filter((node) => node.getMesh());
  let triangles = 0;
  let renderPrimitives = 0;
  for (const node of meshNodes) {
    for (const primitive of node.getMesh().listPrimitives()) {
      const count = primitive.getIndices()?.getCount()
        ?? primitive.getAttribute("POSITION")?.getCount()
        ?? 0;
      triangles += Math.floor(count / 3);
      renderPrimitives += 1;
    }
  }
  return {
    nodes: root.listNodes().length,
    meshBearingNodes: meshNodes.length,
    renderPrimitives,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    triangles,
  };
}

function assertContract(document, label, expectedAuthoringHash, expectedPairId) {
  const root = document.getRoot();
  const scenes = root.listScenes();
  assert(scenes.length === 1, `${label} must contain one scene`);
  assert(scenes[0].getName() === SCENE_NAME, `${label} scene name`);
  const sceneChildren = scenes[0].listChildren();
  assert(sceneChildren.length === 1 && sceneChildren[0].getName() === ROOT_NAME, `${label} scene root`);
  const nodes = root.listNodes();
  const names = nodes.map((node) => node.getName());
  assert(names.every((name) => name && !/\.\d{3}$/u.test(name)), `${label} stable names`);
  assert(new Set(names).size === names.length, `${label} unique names`);
  assert(
    JSON.stringify([...names].sort()) === JSON.stringify([...REQUIRED_NODE_NAMES].sort()),
    `${label} exact hierarchy inventory`,
  );
  const byName = new Map(nodes.map((node) => [node.getName(), node]));
  for (const [name, expectedParent] of Object.entries(PARENT_BY_NAME)) {
    const node = byName.get(name);
    assert(node, `${label} missing ${name}`);
    assert((node.getParentNode()?.getName() ?? null) === expectedParent, `${label} parent for ${name}`);
  }
  for (const name of [ROOT_NAME, "RRR_RivalBikeVisual", "rival-rider"]) {
    assertIdentity(byName.get(name), `${label} ${name}`);
  }
  const materialNames = root.listMaterials().map((material) => material.getName()).sort();
  assert(JSON.stringify(materialNames) === JSON.stringify([...MATERIAL_NAMES].sort()), `${label} materials`);
  const textures = root.listTextures();
  assert(textures.length === 1, `${label} number-field texture count`);
  assert(textures[0].getMimeType() === "image/png", `${label} number-field texture MIME`);
  assert((textures[0].getImage()?.byteLength ?? 0) > 0, `${label} embedded number-field texture`);
  assert(root.listAnimations().length === 0, `${label} animations`);
  const extras = byName.get(ROOT_NAME).getExtras();
  assert(extras.asset_root === true, `${label} provenance marker`);
  assert(extras.asset_source === "Original project-authored Blender-native geometry", `${label} source marker`);
  assert(extras.source_schema === "rrr-rival-pack-v1", `${label} schema`);
  assert(extras.contract === "docs/design/RIVAL_PACK_VERTICAL_SLICE.md", `${label} contract marker`);
  assert(extras.gameplay_authority === "presentation-only", `${label} gameplay authority`);
  assert(extras.shared_geometry === true, `${label} shared-geometry marker`);
  assert(extras.variant_numbers === VARIANT_NUMBERS.join(","), `${label} number variants`);
  assert(extras.authoring_script_sha256 === expectedAuthoringHash, `${label} authoring hash`);
  assert(extras.source_pair_id === expectedPairId, `${label} source-pair id`);
  assert(byName.get("RRR_RivalBikeVisual").getExtras().presentation_only === true, `${label} bike authority`);
  assert(byName.get("rival-rider").getExtras().pose_pivot_count === 6, `${label} pose-pivot count`);
  assert(byName.get("FrontTire").getExtras().animated_axis === "+X", `${label} front wheel axis`);
  assert(byName.get("RearTire").getExtras().animated_axis === "+X", `${label} rear wheel axis`);
  const metrics = collectMetrics(document);
  assert(metrics.nodes === 26, `${label} node count`);
  assert(metrics.meshBearingNodes >= 8 && metrics.meshBearingNodes <= 12, `${label} mesh budget`);
  assert(metrics.renderPrimitives >= 8 && metrics.renderPrimitives <= 12, `${label} primitive budget`);
  assert(metrics.materials === 5, `${label} material count`);
  assert(metrics.textures === 1, `${label} texture count`);
  assert(metrics.triangles >= 15_000 && metrics.triangles <= 20_000, `${label} triangle budget`);
  return { byName, metrics };
}

function parseGlbJson(bytes, label) {
  const data = Buffer.from(bytes);
  assert(data.subarray(0, 4).toString("ascii") === "glTF", `${label} container`);
  assert(data.readUInt32LE(4) === 2, `${label} version`);
  assert(data.readUInt32LE(8) === data.byteLength, `${label} declared length`);
  const jsonLength = data.readUInt32LE(12);
  assert(data.subarray(16, 20).toString("ascii") === "JSON", `${label} JSON chunk`);
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/u, ""));
}

const variantPreviewPaths = VARIANT_NUMBERS.map((number) => path.join(
  SOURCE_DIR,
  `rival-pack-preview-${number}.png`,
));
const [
  sourceBlendBytes,
  sourceGlbBytes,
  sourcePreviewBytes,
  sourceContactSheetBytes,
  sourceReadmeBytes,
  authoringScriptBytes,
  contractBytes,
  builderBytes,
  verifierBytes,
  pngIntegrityBytes,
  packageBytes,
  ...variantPreviewBytes
] = await Promise.all([
  readFile(SOURCE_BLEND_PATH),
  readFile(SOURCE_GLB_PATH),
  readFile(SOURCE_PREVIEW_PATH),
  readFile(SOURCE_CONTACT_SHEET_PATH),
  readFile(SOURCE_README_PATH),
  readFile(AUTHORING_SCRIPT_PATH),
  readFile(CONTRACT_PATH),
  readFile(BUILDER_PATH),
  readFile(VERIFIER_PATH),
  readFile(PNG_INTEGRITY_PATH),
  readFile(PACKAGE_PATH),
  ...variantPreviewPaths.map((filePath) => readFile(filePath)),
]);
inspectPngIntegrity(sourcePreviewBytes, "Rival source preview", { width: 1280, height: 900 });
inspectPngIntegrity(sourceContactSheetBytes, "Rival variant contact sheet", { width: 1920, height: 900 });
variantPreviewBytes.forEach((bytes, index) => {
  inspectPngIntegrity(bytes, `Rival ${VARIANT_NUMBERS[index]} preview`, { width: 640, height: 450 });
});

const authoringScriptSha256 = sha256(authoringScriptBytes);
const io = new NodeIO().registerExtensions([KHRMeshQuantization, EXTMeshoptCompression]);
const document = await io.readBinary(sourceGlbBytes);
const sourceRoot = document.getRoot().listNodes().find((node) => node.getName() === ROOT_NAME);
assert(sourceRoot, "Rival source root is missing");
const sourcePairId = sourceRoot.getExtras().source_pair_id;
assert(typeof sourcePairId === "string" && /^[0-9a-f-]{36}$/u.test(sourcePairId), "Rival source-pair id");
assert(sourceBlendBytes.includes(Buffer.from(sourcePairId, "ascii")), "Rival .blend and raw GLB source pair");
const source = assertContract(document, "Rival source GLB", authoringScriptSha256, sourcePairId);

await document.transform(
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.MATERIAL] }),
  prune({ keepLeaves: true, keepExtras: true }),
);
await MeshoptEncoder.ready;
await document.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
const production = assertContract(document, "Optimized rival GLB", authoringScriptSha256, sourcePairId);
assert(production.metrics.triangles === source.metrics.triangles, "Rival optimization changed triangle coverage");

const outputIO = new NodeIO()
  .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const outputGlbBytes = await outputIO.writeBinary(document);
assert(outputGlbBytes.byteLength <= MAX_RUNTIME_BYTES, "Optimized rival GLB exceeds 2 MiB");
const outputJson = parseGlbJson(outputGlbBytes, "Optimized rival GLB");
assert((outputJson.extensionsUsed ?? []).includes("EXT_meshopt_compression"), "Rival Meshopt extension");
assert((outputJson.extensionsRequired ?? []).includes("EXT_meshopt_compression"), "Rival required Meshopt extension");
assert((outputJson.extensionsRequired ?? []).includes("KHR_mesh_quantization"), "Rival required quantization");
assert(outputJson.cameras === undefined, "Rival cameras are prohibited");
assert(outputJson.animations === undefined, "Rival animations are prohibited");
assert(outputJson.skins === undefined, "Rival skins are prohibited");
assert(outputJson.images?.length === 1 && outputJson.images[0].uri === undefined, "Rival image must remain embedded");
assert(outputJson.buffers?.every((buffer) => buffer.uri === undefined), "Rival buffers must remain embedded");

await MeshoptDecoder.ready;
const decoded = await new NodeIO()
  .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder })
  .readBinary(outputGlbBytes);
const decodedMetrics = assertContract(
  decoded,
  "Decoded optimized rival GLB",
  authoringScriptSha256,
  sourcePairId,
).metrics;
assert(JSON.stringify(decodedMetrics) === JSON.stringify(production.metrics), "Rival decoded metrics changed");

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_GLB_PATH, outputGlbBytes);
const packageManifest = JSON.parse(packageBytes.toString("utf8"));
assert(
  packageManifest.scripts?.["assets:build"]?.includes("node scripts/build-rival-pack-assets.mjs"),
  "package assets:build must include the rival optimizer",
);
assert(
  packageManifest.scripts?.["assets:verify"]?.includes("node scripts/verify-rival-pack-assets.mjs"),
  "package assets:verify must include the independent rival verifier",
);
const manifest = {
  schemaVersion: 2,
  generator: "scripts/build-rival-pack-assets.mjs",
  design: {
    name: "Shared Rival Pack A",
    origin: "Original project-authored Blender-native geometry and generated number field",
    contract: "docs/design/RIVAL_PACK_VERTICAL_SLICE.md",
    authoringTool: "Blender 4.5.11 LTS",
    coordinateSystem: "1 unit = 1 meter; source +Y forward/+Z up; glTF +Y up/-Z forward",
    gameplayAuthority: "Presentation only; TypeScript AI simulation remains authoritative",
    sourcePairId,
    variants: VARIANT_NUMBERS,
    runtimeStrategy: "Load once; clone five times with shared geometry and per-entrant materials",
  },
  compression: {
    geometry: "EXT_meshopt_compression (required, high/filter mode)",
    quantization: "KHR_mesh_quantization (required)",
    rawGlbBytes: sourceGlbBytes.byteLength,
    optimizedGlbBytes: outputGlbBytes.byteLength,
    glbReductionPercent: Number(((1 - outputGlbBytes.byteLength / sourceGlbBytes.byteLength) * 100).toFixed(1)),
    textures: "One embedded project-generated 128x64 opaque PNG number field",
  },
  hierarchy: {
    scene: SCENE_NAME,
    root: ROOT_NAME,
    requiredNodes: REQUIRED_NODE_NAMES,
    posePivots: REQUIRED_NODE_NAMES.filter((name) => name.startsWith("rider-") && name.endsWith("-pivot")),
  },
  metrics: {
    source: source.metrics,
    production: production.metrics,
  },
  dependencies: [
    { package: "@gltf-transform/core", version: packageManifest.devDependencies["@gltf-transform/core"], license: "MIT", use: "glTF I/O and inspection" },
    { package: "@gltf-transform/extensions", version: packageManifest.devDependencies["@gltf-transform/extensions"], license: "MIT", use: "Meshopt and quantization extension I/O" },
    { package: "@gltf-transform/functions", version: packageManifest.devDependencies["@gltf-transform/functions"], license: "MIT", use: "deduplication, pruning, and Meshopt transform" },
    { package: "meshoptimizer", version: packageManifest.devDependencies.meshoptimizer, license: "MIT", use: "build-time geometry encoder" },
  ],
  pipeline: {
    assetBuilder: fileRecord(BUILDER_PATH, builderBytes),
    independentVerifier: fileRecord(VERIFIER_PATH, verifierBytes),
    pngIntegrityInspector: fileRecord(PNG_INTEGRITY_PATH, pngIntegrityBytes),
    packageManifest: fileRecord(PACKAGE_PATH, packageBytes),
  },
  files: {
    editableSource: fileRecord(SOURCE_BLEND_PATH, sourceBlendBytes),
    rawInterchange: fileRecord(SOURCE_GLB_PATH, sourceGlbBytes),
    sourcePreview: fileRecord(SOURCE_PREVIEW_PATH, sourcePreviewBytes),
    variantContactSheet: fileRecord(SOURCE_CONTACT_SHEET_PATH, sourceContactSheetBytes),
    variantPreviews: variantPreviewPaths.map((filePath, index) => fileRecord(filePath, variantPreviewBytes[index])),
    sourceReadme: fileRecord(SOURCE_README_PATH, sourceReadmeBytes),
    authoringProcedure: fileRecord(AUTHORING_SCRIPT_PATH, authoringScriptBytes),
    contract: fileRecord(CONTRACT_PATH, contractBytes),
    runtime: fileRecord(OUTPUT_GLB_PATH, outputGlbBytes),
  },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(MANIFEST_PATH, manifestBytes);

console.log(`Generated ${relative(OUTPUT_GLB_PATH)} (${outputGlbBytes.byteLength} bytes)`);
console.log(`Rival metrics: ${JSON.stringify(production.metrics)}`);
console.log(`Meshopt GLB reduction: ${sourceGlbBytes.byteLength} -> ${outputGlbBytes.byteLength} bytes`);
console.log(`Generated ${relative(MANIFEST_PATH)} (${manifestBytes.byteLength} bytes)`);
