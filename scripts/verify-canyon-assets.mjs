import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMaterialsEmissiveStrength,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { validateBytes } from "gltf-validator";
import { MeshoptDecoder } from "meshoptimizer";

import { inspectPngIntegrity } from "./lib/png-integrity.mjs";

const VERIFIER_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(VERIFIER_PATH), "..");
const BUILDER_PATH = path.join(ROOT, "scripts/build-canyon-assets.mjs");
const PNG_INTEGRITY_PATH = path.join(ROOT, "scripts/lib/png-integrity.mjs");
const ASSET_DIR = path.join(ROOT, "public/assets/canyon");
const MODEL_PATH = path.join(ASSET_DIR, "canyon-kit.glb");
const MANIFEST_PATH = path.join(ASSET_DIR, "asset-manifest.json");
const SOURCE_BLEND_PATH = path.join(ROOT, "art-source/blender/canyon-kit/generated/canyon-kit-source.blend");
const SOURCE_GLB_PATH = path.join(ROOT, "art-source/blender/canyon-kit/generated/canyon-kit-raw.glb");
const SOURCE_README_PATH = path.join(ROOT, "art-source/blender/canyon-kit/README.md");
const AUTHORING_SCRIPT_PATH = path.join(ROOT, "art-source/blender/canyon-kit/build_canyon_kit.py");
const REFERENCE_PATH = path.join(ROOT, "docs/design/concepts/canyon-production-asset-reference.png");
const CONTRACT_PATH = path.join(ROOT, "docs/design/CANYON_VERTICAL_SLICE.md");
const PACKAGE_PATH = path.join(ROOT, "package.json");
const EXPECTED_ROOTS = Object.freeze([
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
]);
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SOURCE_SCENE_EXTRA_KEYS = Object.freeze([
  "asset_set",
  "authoring_blender_version",
  "authoring_script_sha256",
  "generator",
  "project",
  "source_classification",
  "source_pair_id",
  "source_schema",
]);
const EXPECTED = Object.freeze({
  sourceBlend: {
    bytes: 3_556_922,
    sha256: "6eb95c6828cecc086e339ca862d451888e965101d8e897297decdd9b97fd33ef",
  },
  sourceGlb: {
    bytes: 2_310_368,
    sha256: "f35edfe72d6071fefaf20370335120a0047f9b707abcb9929001b7c5d50655cb",
  },
  model: {
    bytes: 427_028,
    sha256: "283be67d91cce4b0dc7b0f7e291811c62c77384f5e3f226cca71d41ce890ff7d",
  },
  sourceMetrics: { nodes: 275, meshes: 264, materials: 20, triangles: 32_008 },
  productionMetrics: { nodes: 73, meshes: 62, materials: 20, triangles: 32_008 },
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertRegularFile(filePath) {
  const details = await lstat(filePath);
  assert.equal(details.isSymbolicLink(), false, `${path.relative(ROOT, filePath)} must not be a symlink`);
  assert.equal(details.isFile(), true, `${path.relative(ROOT, filePath)} must be a regular file`);
}

function assertExactFile(bytes, expected, label) {
  assert.equal(bytes.byteLength, expected.bytes, `${label} byte length changed`);
  assert.equal(sha256(bytes), expected.sha256, `${label} SHA-256 changed`);
}

function manifestFileRecord(filePath, bytes, extra = {}) {
  return {
    path: path.relative(ROOT, filePath).split(path.sep).join("/"),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    ...extra,
  };
}

function assertManifestFile(record, filePath, bytes, extra = {}) {
  assert.deepEqual(
    record,
    manifestFileRecord(filePath, bytes, extra),
    `${path.relative(ROOT, filePath)} manifest record`,
  );
}

function parseGlbJson(bytes) {
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF", "Canyon model must be a GLB");
  assert.equal(bytes.readUInt32LE(4), 2, "Canyon model must use GLB container version 2");
  assert.equal(bytes.readUInt32LE(8), bytes.byteLength, "Canyon GLB declared length must match exact bytes");
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.subarray(16, 20).toString("ascii"), "JSON", "Canyon GLB first chunk must be JSON");
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/u, ""));
}

function countTriangles(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const count = primitive.getIndices()?.getCount()
        ?? primitive.getAttribute("POSITION")?.getCount()
        ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return triangles;
}

function assertSceneProvenance(extras, authoringScriptSha256, expectedSourcePairId, label) {
  assert.deepEqual(Object.keys(extras).sort(), [...SOURCE_SCENE_EXTRA_KEYS].sort(), `${label} scene extras`);
  assert.equal(extras.project, "RIVET RIDGE RALLY", `${label} project binding`);
  assert.equal(extras.asset_set, "Canyon Modular Kit A", `${label} asset-set binding`);
  assert.equal(
    extras.generator,
    "art-source/blender/canyon-kit/build_canyon_kit.py",
    `${label} authoring procedure`,
  );
  assert.equal(
    extras.source_classification,
    "Original project-authored Blender-native geometry",
    `${label} source classification`,
  );
  assert.equal(extras.authoring_blender_version, "4.5.11 LTS", `${label} Blender version`);
  assert.equal(extras.authoring_script_sha256, authoringScriptSha256, `${label} authoring hash`);
  assert.equal(extras.source_schema, "rrr-canyon-kit-v1", `${label} source schema`);
  assert.match(extras.source_pair_id, UUID_V4_PATTERN, `${label} source-pair identifier`);
  assert.equal(extras.source_pair_id, expectedSourcePairId, `${label} source-pair binding`);
}

const artifactPaths = [
  MODEL_PATH,
  MANIFEST_PATH,
  SOURCE_BLEND_PATH,
  SOURCE_GLB_PATH,
  SOURCE_README_PATH,
  AUTHORING_SCRIPT_PATH,
  REFERENCE_PATH,
  CONTRACT_PATH,
  BUILDER_PATH,
  VERIFIER_PATH,
  PNG_INTEGRITY_PATH,
  PACKAGE_PATH,
];
await Promise.all(artifactPaths.map(assertRegularFile));
assert.deepEqual(
  (await readdir(ASSET_DIR)).sort(),
  ["asset-manifest.json", "canyon-kit.glb"],
  "public/assets/canyon must contain only its exact generated contract",
);

const [
  modelBytes,
  manifestBytes,
  sourceBlendBytes,
  sourceGlbBytes,
  sourceReadmeBytes,
  authoringScriptBytes,
  referenceBytes,
  contractBytes,
  builderBytes,
  verifierBytes,
  pngIntegrityBytes,
  packageBytes,
] = await Promise.all(artifactPaths.map((filePath) => readFile(filePath)));
assertExactFile(modelBytes, EXPECTED.model, "Canyon runtime GLB");
assertExactFile(sourceBlendBytes, EXPECTED.sourceBlend, "Canyon editable Blender source");
assertExactFile(sourceGlbBytes, EXPECTED.sourceGlb, "Canyon raw interchange GLB");
const authoringScriptSha256 = sha256(authoringScriptBytes);
assert.equal(
  sourceBlendBytes.subarray(0, 12).toString("ascii"),
  "BLENDER-v405",
  "Canyon editable source must be a Blender 4.5 file",
);
assert(
  sourceBlendBytes.includes(Buffer.from(authoringScriptSha256, "ascii")),
  "Canyon editable source must bind the current authoring procedure hash",
);
const reference = inspectPngIntegrity(referenceBytes, "Canyon production modeling reference", {
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
  "compression",
  "dependencies",
  "design",
  "files",
  "generator",
  "metrics",
  "pipeline",
  "roots",
  "schemaVersion",
  "sourcePairId",
]);
assert.equal(manifest.schemaVersion, 2, "Canyon manifest schema");
assert.equal(manifest.generator, "scripts/build-canyon-assets.mjs", "Canyon manifest generator");
assert.match(manifest.sourcePairId, UUID_V4_PATTERN, "Canyon manifest source-pair identifier");
assert(
  sourceBlendBytes.includes(Buffer.from(manifest.sourcePairId, "ascii")),
  "Canyon editable source must bind the manifest source pair",
);
assert.deepEqual(manifest.design, {
  name: "Canyon Modular Kit A",
  origin: "Original project-authored Blender-native geometry and solid-color PBR materials",
  reference: "docs/design/concepts/canyon-production-asset-reference.png",
  referenceOrigin: "Project-specific original modeling reference generated with OpenAI ImageGen from project-owned gameplay concepts; no third-party model or texture was supplied",
  referenceUsage: "Modeling and material guide only; not sampled, projected, or shipped as a runtime texture",
  contract: "docs/design/CANYON_VERTICAL_SLICE.md",
  authoringProcedure: "art-source/blender/canyon-kit/build_canyon_kit.py",
  authoringTool: "Blender 4.5.11 LTS",
  coordinateSystem: "1 unit = 1 meter; source +Y forward/+Z up; glTF +Y up/-Z forward",
  gameplayAuthority: "Presentation only; TypeScript simulation/contact/course data remain authoritative",
});
assert.deepEqual(manifest.roots, EXPECTED_ROOTS);
assert.deepEqual(Object.keys(manifest.metrics).sort(), ["production", "reference", "source"]);
assert.deepEqual(manifest.metrics.reference, reference, "Canyon manifest reference metrics");
assert.deepEqual(manifest.metrics.source, EXPECTED.sourceMetrics);
assert.deepEqual(manifest.metrics.production, EXPECTED.productionMetrics);
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
assert.deepEqual(manifest.dependencies, [
  { package: "@gltf-transform/core", version: packageManifest.devDependencies["@gltf-transform/core"], license: "MIT", use: "glTF I/O and inspection" },
  { package: "@gltf-transform/extensions", version: packageManifest.devDependencies["@gltf-transform/extensions"], license: "MIT", use: "glTF extension I/O" },
  { package: "@gltf-transform/functions", version: packageManifest.devDependencies["@gltf-transform/functions"], license: "MIT", use: "material deduplication, draw-call joining, pruning, and Meshopt transform" },
  { package: "meshoptimizer", version: packageManifest.devDependencies.meshoptimizer, license: "MIT", use: "build-time geometry encoder" },
]);
assert.deepEqual(
  Object.keys(manifest.pipeline).sort(),
  ["assetBuilder", "independentVerifier", "packageManifest", "pngIntegrityInspector"].sort(),
);
assertManifestFile(manifest.pipeline.assetBuilder, BUILDER_PATH, builderBytes);
assertManifestFile(manifest.pipeline.independentVerifier, VERIFIER_PATH, verifierBytes);
assertManifestFile(manifest.pipeline.pngIntegrityInspector, PNG_INTEGRITY_PATH, pngIntegrityBytes);
assertManifestFile(manifest.pipeline.packageManifest, PACKAGE_PATH, packageBytes);
assert.deepEqual(
  Object.keys(manifest.files).sort(),
  [
    "authoringProcedure",
    "contract",
    "editableSource",
    "rawInterchange",
    "referenceConcept",
    "runtime",
    "sourceReadme",
  ].sort(),
);
assertManifestFile(manifest.files.referenceConcept, REFERENCE_PATH, referenceBytes, reference);
assertManifestFile(manifest.files.contract, CONTRACT_PATH, contractBytes);
assertManifestFile(manifest.files.sourceReadme, SOURCE_README_PATH, sourceReadmeBytes);
assertManifestFile(manifest.files.authoringProcedure, AUTHORING_SCRIPT_PATH, authoringScriptBytes);
assertManifestFile(manifest.files.editableSource, SOURCE_BLEND_PATH, sourceBlendBytes);
assertManifestFile(manifest.files.rawInterchange, SOURCE_GLB_PATH, sourceGlbBytes);
assertManifestFile(manifest.files.runtime, MODEL_PATH, modelBytes);
assert.match(packageManifest.scripts["assets:build"], /node scripts\/build-canyon-assets\.mjs/u);
assert.match(packageManifest.scripts["assets:verify"], /node scripts\/verify-canyon-assets\.mjs/u);

const json = parseGlbJson(modelBytes);
assert.equal(json.asset.version, "2.0");
assert.equal(json.asset.generator, "glTF-Transform v4.4.1");
assert.deepEqual(
  [...(json.extensionsUsed ?? [])].sort(),
  ["EXT_meshopt_compression", "KHR_materials_emissive_strength", "KHR_mesh_quantization"].sort(),
);
assert.deepEqual(
  [...(json.extensionsRequired ?? [])].sort(),
  ["EXT_meshopt_compression", "KHR_mesh_quantization"].sort(),
);
assert.equal(json.nodes.length, EXPECTED.productionMetrics.nodes);
assert.equal(json.meshes.length, EXPECTED.productionMetrics.meshes);
assert.equal(json.materials.length, EXPECTED.productionMetrics.materials);
assert.equal(json.textures, undefined, "Canyon production GLB must not contain untracked textures");
assert.equal(json.images, undefined, "Canyon production GLB must not contain untracked images");
assert.equal(json.cameras, undefined, "Canyon production GLB must not contain cameras");
assert.equal(json.animations, undefined, "Canyon production GLB must not contain animations");
assert.equal(json.extensions?.KHR_lights_punctual, undefined, "Canyon production GLB must not contain lights");
assert.equal(
  json.materials.some((material) => material.alphaMode === "BLEND"),
  true,
  "Canyon cooling field must retain its transparent material",
);
assert.equal(
  json.materials.some((material) => material.extensions?.KHR_materials_emissive_strength?.emissiveStrength >= 4),
  true,
  "Canyon cooling field must retain its bounded emissive-strength extension",
);
assert.deepEqual(
  json.scenes[json.scene ?? 0].nodes.map((index) => json.nodes[index].name),
  EXPECTED_ROOTS,
);
assertSceneProvenance(
  json.scenes[json.scene ?? 0].extras,
  authoringScriptSha256,
  manifest.sourcePairId,
  "Canyon production GLB",
);
assert.deepEqual(
  json.nodes.filter((node) => /\.\d{3}$/u.test(node.name ?? "")),
  [],
  "Canyon production node names must not contain Blender-generated numeric suffixes",
);

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([
    KHRMaterialsEmissiveStrength,
    KHRMeshQuantization,
    EXTMeshoptCompression,
  ])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const document = await io.readBinary(modelBytes);
const scene = document.getRoot().listScenes()[0];
assert(scene, "Decoded Canyon GLB must contain one scene");
assert.deepEqual(scene.listChildren().map((node) => node.getName()), EXPECTED_ROOTS);
for (const node of scene.listChildren()) {
  assert.deepEqual(node.getTranslation(), [0, 0, 0], `${node.getName()} root translation changed`);
  assert.deepEqual(node.getRotation(), [0, 0, 0, 1], `${node.getName()} root rotation changed`);
  assert.deepEqual(node.getScale(), [1, 1, 1], `${node.getName()} root scale changed`);
}
assert.equal(document.getRoot().listNodes().length, EXPECTED.productionMetrics.nodes);
assert.equal(document.getRoot().listMeshes().length, EXPECTED.productionMetrics.meshes);
assert.equal(document.getRoot().listMaterials().length, EXPECTED.productionMetrics.materials);
assert.equal(document.getRoot().listTextures().length, 0);
assert.equal(countTriangles(document), EXPECTED.productionMetrics.triangles);

const sourceJson = parseGlbJson(sourceGlbBytes);
const sourceSceneJson = sourceJson.scenes[sourceJson.scene ?? 0];
assert(sourceSceneJson, "Canyon source GLB must contain one scene");
assert.deepEqual(
  sourceSceneJson.nodes.map((index) => sourceJson.nodes[index].name),
  EXPECTED_ROOTS,
  "Canyon source roots",
);
assertSceneProvenance(
  sourceSceneJson.extras,
  authoringScriptSha256,
  manifest.sourcePairId,
  "Canyon source GLB",
);

const validation = await validateBytes(new Uint8Array(modelBytes), {
  uri: "canyon-kit.glb",
  maxIssues: 100,
  externalResourceFunction: async () => {
    throw new Error("Canyon GLB must not request an external resource");
  },
});
assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues.messages, null, 2));

console.log(
  `Verified Canyon modular kit: ${EXPECTED.productionMetrics.triangles.toLocaleString()} triangles, `
    + `${EXPECTED.productionMetrics.meshes} meshes, ${EXPECTED.productionMetrics.materials} materials, `
    + `${EXPECTED.model.bytes.toLocaleString()} bytes.`,
);
