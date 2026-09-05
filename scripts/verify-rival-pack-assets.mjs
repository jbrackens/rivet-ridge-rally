import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { validateBytes } from "gltf-validator";
import { MeshoptDecoder } from "meshoptimizer";

import { inspectPngIntegrity } from "./lib/png-integrity.mjs";

const VERIFIER_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(VERIFIER_PATH), "..");
const BUILDER_PATH = path.join(ROOT, "scripts/build-rival-pack-assets.mjs");
const PNG_INTEGRITY_PATH = path.join(ROOT, "scripts/lib/png-integrity.mjs");
const PACKAGE_PATH = path.join(ROOT, "package.json");
const ASSET_DIR = path.join(ROOT, "public/assets/rivals");
const MODEL_PATH = path.join(ASSET_DIR, "rival-pack.glb");
const MANIFEST_PATH = path.join(ASSET_DIR, "asset-manifest.json");
const SOURCE_DIR = path.join(ROOT, "art-source/blender/rival-pack/generated");
const SOURCE_BLEND_PATH = path.join(SOURCE_DIR, "rival-pack-source.blend");
const SOURCE_GLB_PATH = path.join(SOURCE_DIR, "rival-pack-raw.glb");
const SOURCE_PREVIEW_PATH = path.join(SOURCE_DIR, "rival-pack-preview.png");
const CONTACT_SHEET_PATH = path.join(SOURCE_DIR, "rival-pack-variants-contact-sheet.png");
const SOURCE_README_PATH = path.join(ROOT, "art-source/blender/rival-pack/README.md");
const AUTHORING_SCRIPT_PATH = path.join(ROOT, "art-source/blender/rival-pack/build_rival_pack.py");
const CONTRACT_PATH = path.join(ROOT, "docs/design/RIVAL_PACK_VERTICAL_SLICE.md");
const VARIANT_NUMBERS = Object.freeze(["17", "31", "46", "58", "73"]);
const VARIANT_PREVIEW_PATHS = VARIANT_NUMBERS.map((number) => path.join(
  SOURCE_DIR,
  `rival-pack-preview-${number}.png`,
));
const ROOT_NAME = "RRR_RivalPackBase";
const SCENE_NAME = "RRR_RivalPackScene";
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
const MATERIAL_NAMES = Object.freeze([
  "RRR_RivalPrimary",
  "RRR_RivalAccent",
  "RRR_RivalHardware",
  "RRR_RivalWheel",
  "RRR_RivalNumberField",
]);
const EXPECTED = Object.freeze({
  model: { bytes: 193_884, sha256: "09043547981c80d66fca23aa208971b6b2f457890cafabeed4258dbc0fdbb805" },
  sourceBlend: { bytes: 1_538_617, sha256: "a3cf4b447bf072eb377066ee6a02af6902e7a6086ff1769fcce63fe936935a91" },
  sourceGlb: { bytes: 1_281_044, sha256: "0fbaa36869c659636a53608fc05a6d0656d61679ff4198d25880bfffda1ee0ce" },
  sourcePreview: { bytes: 1_236_602, sha256: "5e75ff066df4e5ece2c90e475b3828cc3ccbdcae6be87294e99065962fb225cd" },
  contactSheet: { bytes: 1_197_501, sha256: "67af3ab31b6357c797f200663cb6c3368608303b93b4a0544172e69a9fe54f5d" },
  variantPreviews: [
    { bytes: 336_362, sha256: "07bdb986838cda8cebf0d19caa9ae28f27170e6f391886a7820edcce3f9b3090" },
    { bytes: 336_707, sha256: "12f7b843034fe9d70ea38f07d1a6432a5f21040c3bcd17fff4da45f39253087c" },
    { bytes: 331_681, sha256: "f4026e9e0ce8e646858c61849d6249931b1a587cbae8367c5135d1f2808cfdaf" },
    { bytes: 337_538, sha256: "e2f7bf33489d5652b2902d985176ee5681ac760806f278c38377c8e01f832e82" },
    { bytes: 337_061, sha256: "b0728dda349bb3b862badff93971fb6e866899e7f4a8e22267879cfe9e06946d" },
  ],
  metrics: {
    nodes: 26,
    meshBearingNodes: 12,
    renderPrimitives: 12,
    materials: 5,
    textures: 1,
    triangles: 19_588,
  },
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

function assertManifestFile(record, filePath, bytes) {
  assert.deepEqual(record, {
    path: path.relative(ROOT, filePath).split(path.sep).join("/"),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}

function parseGlbJson(bytes) {
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.byteLength);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").replace(/\0+$/u, ""));
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

const allPaths = [
  MODEL_PATH,
  MANIFEST_PATH,
  SOURCE_BLEND_PATH,
  SOURCE_GLB_PATH,
  SOURCE_PREVIEW_PATH,
  CONTACT_SHEET_PATH,
  ...VARIANT_PREVIEW_PATHS,
];
const supportPaths = [
  SOURCE_README_PATH,
  AUTHORING_SCRIPT_PATH,
  CONTRACT_PATH,
  BUILDER_PATH,
  VERIFIER_PATH,
  PNG_INTEGRITY_PATH,
  PACKAGE_PATH,
];
await Promise.all([...allPaths, ...supportPaths].map(assertRegularFile));
assert.deepEqual(
  (await readdir(ASSET_DIR)).sort(),
  ["asset-manifest.json", "rival-pack.glb"],
  "public/assets/rivals exact directory contract",
);

const [
  modelBytes,
  manifestBytes,
  sourceBlendBytes,
  sourceGlbBytes,
  sourcePreviewBytes,
  contactSheetBytes,
  ...variantPreviewBytes
] = await Promise.all(allPaths.map((filePath) => readFile(filePath)));
const [
  sourceReadmeBytes,
  authoringScriptBytes,
  contractBytes,
  builderBytes,
  verifierBytes,
  pngIntegrityBytes,
  packageBytes,
] = await Promise.all(supportPaths.map((filePath) => readFile(filePath)));
assertExactFile(modelBytes, EXPECTED.model, "Rival runtime GLB");
assertExactFile(sourceBlendBytes, EXPECTED.sourceBlend, "Rival Blender source");
assertExactFile(sourceGlbBytes, EXPECTED.sourceGlb, "Rival raw GLB");
assertExactFile(sourcePreviewBytes, EXPECTED.sourcePreview, "Rival source preview");
assertExactFile(contactSheetBytes, EXPECTED.contactSheet, "Rival contact sheet");
variantPreviewBytes.forEach((bytes, index) => {
  assertExactFile(bytes, EXPECTED.variantPreviews[index], `Rival ${VARIANT_NUMBERS[index]} preview`);
});
inspectPngIntegrity(sourcePreviewBytes, "Rival source preview", { width: 1280, height: 900 });
inspectPngIntegrity(contactSheetBytes, "Rival contact sheet", { width: 1920, height: 900 });
variantPreviewBytes.forEach((bytes, index) => {
  inspectPngIntegrity(bytes, `Rival ${VARIANT_NUMBERS[index]} preview`, { width: 640, height: 450 });
});

const manifest = JSON.parse(manifestBytes.toString("utf8"));
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.generator, "scripts/build-rival-pack-assets.mjs");
assert.equal(manifest.design.name, "Shared Rival Pack A");
assert.equal(manifest.design.gameplayAuthority, "Presentation only; TypeScript AI simulation remains authoritative");
assert.deepEqual(manifest.design.variants, VARIANT_NUMBERS);
assert.equal(manifest.design.runtimeStrategy, "Load once; clone five times with shared geometry and per-entrant materials");
assert.deepEqual(manifest.metrics.source, EXPECTED.metrics);
assert.deepEqual(manifest.metrics.production, EXPECTED.metrics);
assert.equal(manifest.files.runtime.sha256, EXPECTED.model.sha256);
assert.equal(manifest.files.editableSource.sha256, EXPECTED.sourceBlend.sha256);
assert.equal(manifest.files.rawInterchange.sha256, EXPECTED.sourceGlb.sha256);
assertManifestFile(manifest.files.editableSource, SOURCE_BLEND_PATH, sourceBlendBytes);
assertManifestFile(manifest.files.rawInterchange, SOURCE_GLB_PATH, sourceGlbBytes);
assertManifestFile(manifest.files.sourcePreview, SOURCE_PREVIEW_PATH, sourcePreviewBytes);
assertManifestFile(manifest.files.variantContactSheet, CONTACT_SHEET_PATH, contactSheetBytes);
assert.equal(manifest.files.variantPreviews.length, VARIANT_PREVIEW_PATHS.length);
manifest.files.variantPreviews.forEach((record, index) => {
  assertManifestFile(record, VARIANT_PREVIEW_PATHS[index], variantPreviewBytes[index]);
});
assertManifestFile(manifest.files.sourceReadme, SOURCE_README_PATH, sourceReadmeBytes);
assertManifestFile(manifest.files.authoringProcedure, AUTHORING_SCRIPT_PATH, authoringScriptBytes);
assertManifestFile(manifest.files.contract, CONTRACT_PATH, contractBytes);
assertManifestFile(manifest.files.runtime, MODEL_PATH, modelBytes);
assertManifestFile(manifest.pipeline.assetBuilder, BUILDER_PATH, builderBytes);
assertManifestFile(manifest.pipeline.independentVerifier, VERIFIER_PATH, verifierBytes);
assertManifestFile(manifest.pipeline.pngIntegrityInspector, PNG_INTEGRITY_PATH, pngIntegrityBytes);
assertManifestFile(manifest.pipeline.packageManifest, PACKAGE_PATH, packageBytes);
assert.deepEqual(
  Object.keys(manifest.pipeline).sort(),
  ["assetBuilder", "independentVerifier", "packageManifest", "pngIntegrityInspector"].sort(),
);
const packageManifest = JSON.parse(packageBytes.toString("utf8"));
assert.match(packageManifest.scripts["assets:build"], /node scripts\/build-rival-pack-assets\.mjs/u);
assert.match(packageManifest.scripts["assets:verify"], /node scripts\/verify-rival-pack-assets\.mjs/u);

const json = parseGlbJson(modelBytes);
assert.equal(json.asset.version, "2.0");
assert.deepEqual(
  [...(json.extensionsRequired ?? [])].sort(),
  ["EXT_meshopt_compression", "KHR_mesh_quantization"].sort(),
);
assert.equal(json.cameras, undefined);
assert.equal(json.animations, undefined);
assert.equal(json.skins, undefined);
assert.equal(json.images.length, 1);
assert.equal(json.images[0].uri, undefined);
assert.equal(json.images[0].mimeType, "image/png");
assert.equal(json.textures.length, 1);
assert.equal(json.materials.length, 5);
assert.deepEqual(json.materials.map((material) => material.name).sort(), [...MATERIAL_NAMES].sort());

const validation = await validateBytes(new Uint8Array(modelBytes), {
  uri: "rival-pack.glb",
  maxIssues: 100,
});
assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues.messages, null, 2));
assert.equal(validation.issues.numWarnings, 0, JSON.stringify(validation.issues.messages, null, 2));

await MeshoptDecoder.ready;
const document = await new NodeIO()
  .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder })
  .readBinary(modelBytes);
assert.deepEqual(collectMetrics(document), EXPECTED.metrics);
const scenes = document.getRoot().listScenes();
assert.equal(scenes.length, 1);
assert.equal(scenes[0].getName(), SCENE_NAME);
assert.equal(scenes[0].listChildren()[0].getName(), ROOT_NAME);
const nodes = document.getRoot().listNodes();
assert.equal(new Set(nodes.map((node) => node.getName())).size, nodes.length);
const byName = new Map(nodes.map((node) => [node.getName(), node]));
assert.deepEqual([...byName.keys()].sort(), Object.keys(PARENT_BY_NAME).sort());
for (const [name, expectedParent] of Object.entries(PARENT_BY_NAME)) {
  assert.equal(byName.get(name).getParentNode()?.getName() ?? null, expectedParent, `${name} parent`);
}
const extras = byName.get(ROOT_NAME).getExtras();
assert.equal(extras.asset_source, "Original project-authored Blender-native geometry");
assert.equal(extras.source_schema, "rrr-rival-pack-v1");
assert.equal(extras.shared_geometry, true);
assert.equal(extras.variant_numbers, VARIANT_NUMBERS.join(","));
assert.equal(extras.gameplay_authority, "presentation-only");
assert.ok(sourceBlendBytes.includes(Buffer.from(extras.source_pair_id, "ascii")));

console.log("Rival pack asset verification passed.");
