import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO, PropertyType } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMaterialsEmissiveStrength,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { dedup, join, meshopt, prune } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

import { inspectPngIntegrity } from "./lib/png-integrity.mjs";

const BUILDER_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(BUILDER_PATH), "..");
const VERIFIER_PATH = path.join(ROOT, "scripts/verify-canyon-assets.mjs");
const PNG_INTEGRITY_PATH = path.join(ROOT, "scripts/lib/png-integrity.mjs");
const SOURCE_DIR = path.join(ROOT, "art-source/blender/canyon-kit/generated");
const SOURCE_BLEND_PATH = path.join(SOURCE_DIR, "canyon-kit-source.blend");
const SOURCE_GLB_PATH = path.join(SOURCE_DIR, "canyon-kit-raw.glb");
const SOURCE_README_PATH = path.join(ROOT, "art-source/blender/canyon-kit/README.md");
const AUTHORING_SCRIPT_PATH = path.join(
  ROOT,
  "art-source/blender/canyon-kit/build_canyon_kit.py",
);
const REFERENCE_PATH = path.join(
  ROOT,
  "docs/design/concepts/canyon-production-asset-reference.png",
);
const CONTRACT_PATH = path.join(ROOT, "docs/design/CANYON_VERTICAL_SLICE.md");
const OUTPUT_DIR = path.join(ROOT, "public/assets/canyon");
const OUTPUT_GLB_PATH = path.join(OUTPUT_DIR, "canyon-kit.glb");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "asset-manifest.json");
const PACKAGE_PATH = path.join(ROOT, "package.json");
const ROOT_NAMES = Object.freeze([
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
const ROOT_NAME_SET = new Set(ROOT_NAMES);
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

function countTriangles(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const count = indices?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return triangles;
}

function assertIdentityRoot(node) {
  assert(node.getTranslation().every((value) => Math.abs(value) <= 1e-7), `${node.getName()} translation must be identity`);
  const rotation = node.getRotation();
  assert(
    Math.abs(rotation[0]) <= 1e-7
      && Math.abs(rotation[1]) <= 1e-7
      && Math.abs(rotation[2]) <= 1e-7
      && Math.abs(rotation[3] - 1) <= 1e-7,
    `${node.getName()} rotation must be identity`,
  );
  assert(node.getScale().every((value) => Math.abs(value - 1) <= 1e-7), `${node.getName()} scale must be identity`);
}

function assertSceneProvenance(scene, authoringScriptSha256, expectedSourcePairId, label) {
  const extras = scene.getExtras();
  assert(
    JSON.stringify(Object.keys(extras).sort()) === JSON.stringify([...SOURCE_SCENE_EXTRA_KEYS].sort()),
    `${label} scene extras changed`,
  );
  assert(extras.project === "RIVET RIDGE RALLY", `${label} project binding changed`);
  assert(extras.asset_set === "Canyon Modular Kit A", `${label} asset-set binding changed`);
  assert(
    extras.generator === "art-source/blender/canyon-kit/build_canyon_kit.py",
    `${label} authoring procedure changed`,
  );
  assert(
    extras.source_classification === "Original project-authored Blender-native geometry",
    `${label} source classification changed`,
  );
  assert(extras.authoring_blender_version === "4.5.11 LTS", `${label} Blender version changed`);
  assert(extras.authoring_script_sha256 === authoringScriptSha256, `${label} authoring hash changed`);
  assert(extras.source_schema === "rrr-canyon-kit-v1", `${label} source schema changed`);
  assert(UUID_V4_PATTERN.test(extras.source_pair_id), `${label} source-pair identifier is invalid`);
  if (expectedSourcePairId !== null) {
    assert(extras.source_pair_id === expectedSourcePairId, `${label} source-pair binding changed`);
  }
  return extras.source_pair_id;
}

const [
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
] = await Promise.all([
  readFile(SOURCE_BLEND_PATH),
  readFile(SOURCE_GLB_PATH),
  readFile(SOURCE_README_PATH),
  readFile(AUTHORING_SCRIPT_PATH),
  readFile(REFERENCE_PATH),
  readFile(CONTRACT_PATH),
  readFile(BUILDER_PATH),
  readFile(VERIFIER_PATH),
  readFile(PNG_INTEGRITY_PATH),
  readFile(PACKAGE_PATH),
]);
const reference = inspectPngIntegrity(referenceBytes, "Canyon production modeling reference", {
  width: 1_672,
  height: 941,
  bitDepth: 8,
  colorType: 2,
});
const packageManifest = JSON.parse(packageBytes.toString("utf8"));
const authoringScriptSha256 = sha256(authoringScriptBytes);
assert(
  sourceBlendBytes.subarray(0, 12).toString("ascii") === "BLENDER-v405",
  "Canyon editable source must be a Blender 4.5 file",
);
assert(
  sourceBlendBytes.includes(Buffer.from(authoringScriptSha256, "ascii")),
  "Canyon editable source must bind the current authoring procedure hash",
);
assert(
  packageManifest.scripts?.["assets:build"]?.includes("node scripts/build-canyon-assets.mjs"),
  "package assets:build must include the Canyon optimizer",
);
assert(
  packageManifest.scripts?.["assets:verify"]?.includes("node scripts/verify-canyon-assets.mjs"),
  "package assets:verify must include the independent Canyon verifier",
);
const io = new NodeIO().registerExtensions([
  KHRMaterialsEmissiveStrength,
  KHRMeshQuantization,
  EXTMeshoptCompression,
]);
const document = await io.readBinary(sourceGlbBytes);
const sourceScene = document.getRoot().listScenes()[0];
assert(sourceScene, "Canyon source GLB must contain one scene");
const sourcePairId = assertSceneProvenance(
  sourceScene,
  authoringScriptSha256,
  null,
  "Canyon source GLB",
);
assert(
  sourceBlendBytes.includes(Buffer.from(sourcePairId, "ascii")),
  "Canyon editable source must bind the raw GLB from the same authoring run",
);
const sourceRoots = sourceScene.listChildren();
assert(
  JSON.stringify(sourceRoots.map((node) => node.getName())) === JSON.stringify(ROOT_NAMES),
  `Canyon source roots must exactly match: ${ROOT_NAMES.join(", ")}`,
);
sourceRoots.forEach(assertIdentityRoot);
assert(document.getRoot().listTextures().length === 0, "Canyon source must not contain untracked textures");
assert(document.getRoot().listMaterials().length <= 20, "Canyon source exceeds its 20-material budget");
const sourceMetrics = {
  nodes: document.getRoot().listNodes().length,
  meshes: document.getRoot().listMeshes().length,
  materials: document.getRoot().listMaterials().length,
  triangles: countTriangles(document),
};
assert(sourceMetrics.triangles <= 70_000, "Canyon source exceeds its 70,000-triangle budget");

await document.transform(
  dedup({ propertyTypes: [PropertyType.MATERIAL] }),
  join({
    keepNamed: false,
    filter: (node) => !ROOT_NAME_SET.has(node.getName()),
  }),
  prune(),
);
await MeshoptEncoder.ready;
await document.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));

const productionScene = document.getRoot().listScenes()[0];
assert(productionScene, "Optimized Canyon GLB must retain its scene");
assertSceneProvenance(
  productionScene,
  authoringScriptSha256,
  sourcePairId,
  "Optimized Canyon GLB",
);
const productionRoots = productionScene.listChildren();
assert(
  JSON.stringify(productionRoots.map((node) => node.getName())) === JSON.stringify(ROOT_NAMES),
  "Optimization changed the Canyon root contract",
);
productionRoots.forEach(assertIdentityRoot);
const productionMetrics = {
  nodes: document.getRoot().listNodes().length,
  meshes: document.getRoot().listMeshes().length,
  materials: document.getRoot().listMaterials().length,
  triangles: countTriangles(document),
};
assert(productionMetrics.triangles === sourceMetrics.triangles, "Optimization changed Canyon triangle coverage");
assert(productionMetrics.meshes <= 70, "Optimized Canyon kit exceeds its 70-mesh ceiling");

const outputIO = new NodeIO()
  .registerExtensions([
    KHRMaterialsEmissiveStrength,
    KHRMeshQuantization,
    EXTMeshoptCompression,
  ])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const outputGlbBytes = await outputIO.writeBinary(document);
await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_GLB_PATH, outputGlbBytes);

const manifest = {
  schemaVersion: 2,
  generator: "scripts/build-canyon-assets.mjs",
  sourcePairId,
  design: {
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
  },
  compression: {
    geometry: "EXT_meshopt_compression (required, high/filter mode)",
    quantization: "KHR_mesh_quantization (required)",
    rawGlbBytes: sourceGlbBytes.byteLength,
    optimizedGlbBytes: outputGlbBytes.byteLength,
    glbReductionPercent: Number(((1 - outputGlbBytes.byteLength / sourceGlbBytes.byteLength) * 100).toFixed(1)),
    textures: "None; solid-color glTF PBR materials only",
  },
  roots: ROOT_NAMES,
  metrics: {
    reference,
    source: sourceMetrics,
    production: productionMetrics,
  },
  dependencies: [
    { package: "@gltf-transform/core", version: packageManifest.devDependencies["@gltf-transform/core"], license: "MIT", use: "glTF I/O and inspection" },
    { package: "@gltf-transform/extensions", version: packageManifest.devDependencies["@gltf-transform/extensions"], license: "MIT", use: "glTF extension I/O" },
    { package: "@gltf-transform/functions", version: packageManifest.devDependencies["@gltf-transform/functions"], license: "MIT", use: "material deduplication, draw-call joining, pruning, and Meshopt transform" },
    { package: "meshoptimizer", version: packageManifest.devDependencies.meshoptimizer, license: "MIT", use: "build-time geometry encoder" },
  ],
  pipeline: {
    assetBuilder: fileRecord(BUILDER_PATH, builderBytes),
    independentVerifier: fileRecord(VERIFIER_PATH, verifierBytes),
    pngIntegrityInspector: fileRecord(PNG_INTEGRITY_PATH, pngIntegrityBytes),
    packageManifest: fileRecord(PACKAGE_PATH, packageBytes),
  },
  files: {
    referenceConcept: fileRecord(REFERENCE_PATH, referenceBytes, reference),
    contract: fileRecord(CONTRACT_PATH, contractBytes),
    sourceReadme: fileRecord(SOURCE_README_PATH, sourceReadmeBytes),
    authoringProcedure: fileRecord(AUTHORING_SCRIPT_PATH, authoringScriptBytes),
    editableSource: fileRecord(SOURCE_BLEND_PATH, sourceBlendBytes),
    rawInterchange: fileRecord(SOURCE_GLB_PATH, sourceGlbBytes),
    runtime: fileRecord(OUTPUT_GLB_PATH, outputGlbBytes),
  },
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(MANIFEST_PATH, manifestBytes);

console.log(`Generated ${relative(OUTPUT_GLB_PATH)} (${outputGlbBytes.byteLength} bytes)`);
console.log(`Reduced ${sourceMetrics.meshes} source meshes to ${productionMetrics.meshes} production meshes`);
console.log(`Meshopt GLB reduction: ${sourceGlbBytes.byteLength} -> ${outputGlbBytes.byteLength} bytes`);
console.log(`Generated ${relative(MANIFEST_PATH)} (${manifestBytes.byteLength} bytes)`);
