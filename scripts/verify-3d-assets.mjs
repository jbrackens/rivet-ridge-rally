import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
  KHRTextureBasisu,
} from "@gltf-transform/extensions";
import { validateBytes } from "gltf-validator";
import { MeshoptDecoder } from "meshoptimizer";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_PATH = path.join(ROOT, "public/assets/3d/festival-trail-bike.glb");
const TEXTURE_PATH = path.join(ROOT, "public/assets/3d/festival-bike-albedo.ktx2");
const MANIFEST_PATH = path.join(ROOT, "public/assets/3d/asset-manifest.json");
const EXPECTED_MANIFEST_BYTES = 3_369;
const EXPECTED_MANIFEST_SHA256 = "ebd431902d7177bfdaad64733eedf246bb8c31f132a3e063a61188412ae244e7";
const EXPECTED_ASSET_DIRECTORIES = [
  {
    path: path.join(ROOT, "public/assets/3d"),
    entries: ["asset-manifest.json", "festival-bike-albedo.ktx2", "festival-trail-bike.glb"],
  },
  {
    path: path.join(ROOT, "public/assets/transcoders/basis"),
    entries: ["LICENSE.txt", "NOTICE.txt", "README.md", "basis_transcoder.js", "basis_transcoder.wasm"],
  },
];
const EXPECTED_MANIFEST = {
  schemaVersion: 1,
  generator: "scripts/build-3d-assets.mjs",
  design: {
    name: "Festival Trail Bike",
    origin: "Original project-authored procedural geometry and texture; no source model or source image",
  },
  compression: {
    geometry: "EXT_meshopt_compression (required, high/filter mode)",
    quantization: "KHR_mesh_quantization (required)",
    uncompressedGlbBytes: 54_868,
    compressedGlbBytes: 29_132,
    glbReductionPercent: 46.9,
    texture: "KTX2 ETC1S with BasisLZ supercompression, sRGB transfer, and 8 mip levels",
    textureDimensions: [128, 128],
    gltfTextureExtension: "KHR_texture_basisu (required)",
  },
  dependencies: [
    {
      package: "@gltf-transform/core",
      version: "4.4.1",
      license: "MIT",
      use: "GLB authoring",
    },
    {
      package: "@gltf-transform/extensions",
      version: "4.4.1",
      license: "MIT",
      use: "glTF extension I/O",
    },
    {
      package: "@gltf-transform/functions",
      version: "4.4.1",
      license: "MIT",
      use: "Meshopt transform",
    },
    {
      package: "ktx2-encoder",
      version: "0.5.3",
      license: "MIT",
      use: "Build-time Basis encoder wrapper",
    },
    {
      component: "Basis Universal encoder WASM",
      source: "ktx2-encoder@0.5.3",
      license: "Apache-2.0",
      use: "Build-time ETC1S encoding",
    },
    {
      package: "meshoptimizer",
      version: "1.2.0",
      license: "MIT",
      use: "Build-time geometry encoder",
    },
    {
      package: "gltf-validator",
      version: "2.0.0-dev.3.10",
      license: "Apache-2.0",
      use: "Build-time verification",
    },
    {
      package: "three",
      version: "0.185.1",
      license: "MIT",
      use: "Primitive geometry generation and runtime loaders",
    },
    {
      component: "Basis Universal transcoder",
      source: "three@0.185.1/examples/jsm/libs/basis",
      license: "Apache-2.0",
      use: "Runtime KTX2 transcoding",
    },
  ],
  files: [
    {
      path: "public/assets/3d/festival-trail-bike.glb",
      bytes: 29_132,
      sha256: "8668d05f42f3b8303c0825b8d4aa4b9c66a8ef64acba18f2df70b69f9a8f595b",
    },
    {
      path: "public/assets/3d/festival-bike-albedo.ktx2",
      bytes: 2_236,
      sha256: "a86588924b53fd51915d505d0ba23e343ac3e84a5139c687845a49f8ad8a1ba2",
    },
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
  ],
};

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function parseGLB(bytes) {
  const data = Buffer.from(bytes);
  assert.equal(data.readUInt32LE(0), 0x46546c67, "GLB magic");
  assert.equal(data.readUInt32LE(4), 2, "GLB version");
  assert.equal(data.readUInt32LE(8), data.byteLength, "GLB declared byte length");
  const jsonLength = data.readUInt32LE(12);
  assert.equal(data.readUInt32LE(16), 0x4e4f534a, "GLB JSON chunk type");
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8").trim());
  const binaryHeader = 20 + jsonLength;
  const binaryLength = data.readUInt32LE(binaryHeader);
  assert.equal(data.readUInt32LE(binaryHeader + 4), 0x004e4942, "GLB BIN chunk type");
  const binary = data.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength);
  return { json, binary };
}

function inspectKTX2(bytes) {
  const data = Buffer.from(bytes);
  assert.equal(data.subarray(0, 12).toString("hex"), "ab4b5458203230bb0d0a1a0a", "KTX2 identifier");
  const levelCount = data.readUInt32LE(40);
  const levels = [];
  for (let index = 0; index < levelCount; index += 1) {
    const entryOffset = 80 + index * 24;
    const byteOffset = Number(data.readBigUInt64LE(entryOffset));
    const byteLength = Number(data.readBigUInt64LE(entryOffset + 8));
    assert(byteLength > 0, `KTX2 mip ${index} must not be empty`);
    assert(byteOffset + byteLength <= data.byteLength, `KTX2 mip ${index} is out of bounds`);
    levels.push({ byteOffset, byteLength });
  }
  const dfdOffset = data.readUInt32LE(48);
  const dfdLength = data.readUInt32LE(52);
  assert(dfdOffset + dfdLength <= data.byteLength, "KTX2 data format descriptor is out of bounds");
  return {
    vkFormat: data.readUInt32LE(12),
    width: data.readUInt32LE(20),
    height: data.readUInt32LE(24),
    faceCount: data.readUInt32LE(36),
    levelCount,
    supercompressionScheme: data.readUInt32LE(44),
    colorModel: data[dfdOffset + 12],
    colorPrimaries: data[dfdOffset + 13],
    transferFunction: data[dfdOffset + 14],
    levels,
  };
}

const glb = new Uint8Array(await readFile(MODEL_PATH));
const ktx2 = new Uint8Array(await readFile(TEXTURE_PATH));
const manifestBytes = await readFile(MANIFEST_PATH);
assert.equal(manifestBytes.byteLength, EXPECTED_MANIFEST_BYTES, "3D asset manifest byte length");
assert.equal(sha256(manifestBytes), EXPECTED_MANIFEST_SHA256, "3D asset manifest SHA-256");
const manifest = JSON.parse(manifestBytes.toString("utf8"));
assert.deepEqual(
  manifest,
  EXPECTED_MANIFEST,
  "3D asset manifest must match the authoritative provenance, dependency, and file contract",
);
for (const directory of EXPECTED_ASSET_DIRECTORIES) {
  assert.deepEqual(
    (await readdir(directory.path)).sort(),
    [...directory.entries].sort(),
    `${path.relative(ROOT, directory.path)} must contain exactly the authoritative asset set`,
  );
  for (const entry of directory.entries) {
    assert(
      (await lstat(path.join(directory.path, entry))).isFile(),
      `${path.relative(ROOT, path.join(directory.path, entry))} must be a regular file`,
    );
  }
}
const { json, binary } = parseGLB(glb);
const required = new Set(json.extensionsRequired ?? []);

assert(required.has("EXT_meshopt_compression"), "Meshopt extension must be required");
assert(required.has("KHR_mesh_quantization"), "Mesh quantization extension must be required");
assert(required.has("KHR_texture_basisu"), "Basis texture extension must be required");
const meshoptViews = (json.bufferViews ?? []).filter(
  (view) => view.extensions?.EXT_meshopt_compression,
);
assert(meshoptViews.length > 0, "No Meshopt-compressed buffer views found");

const basisTexture = (json.textures ?? []).find(
  (texture) => texture.extensions?.KHR_texture_basisu,
);
assert(basisTexture, "No KHR_texture_basisu texture found");
assert.equal(basisTexture.source, undefined, "Required Basis texture must not include a fallback source");
const imageIndex = basisTexture.extensions.KHR_texture_basisu.source;
const image = json.images[imageIndex];
assert.equal(image.mimeType, "image/ktx2", "Embedded texture MIME type");
const imageView = json.bufferViews[image.bufferView];
const imageOffset = imageView.byteOffset ?? 0;
const embeddedTexture = binary.subarray(imageOffset, imageOffset + imageView.byteLength);
assert.equal(sha256(embeddedTexture), sha256(ktx2), "Embedded and standalone KTX2 must match");

const ktx = inspectKTX2(ktx2);
assert.equal(ktx.vkFormat, 0, "Basis KTX2 vkFormat");
assert.deepEqual([ktx.width, ktx.height], [128, 128], "KTX2 dimensions");
assert.equal(ktx.faceCount, 1, "KTX2 face count");
assert.equal(ktx.levelCount, 8, "KTX2 mip count");
assert.equal(ktx.supercompressionScheme, 1, "BasisLZ supercompression scheme");
assert.equal(ktx.colorModel, 163, "ETC1S data format model");
assert.equal(ktx.colorPrimaries, 1, "BT.709 color primaries");
assert.equal(ktx.transferFunction, 2, "sRGB transfer function");

for (const file of EXPECTED_MANIFEST.files) {
  const bytes = await readFile(path.join(ROOT, file.path));
  assert.equal(bytes.byteLength, file.bytes, `${file.path} byte length`);
  assert.equal(sha256(bytes), file.sha256, `${file.path} SHA-256`);
}

const validator = await validateBytes(glb, {
  uri: "festival-trail-bike.glb",
  maxIssues: 100,
  externalResourceFunction: async () => new Uint8Array(),
});
assert.equal(validator.issues.numErrors, 0, JSON.stringify(validator.issues.messages, null, 2));
const allowedValidatorIssues = new Set([
  "UNSUPPORTED_EXTENSION:/extensionsUsed/0",
  "UNSUPPORTED_EXTENSION:/extensionsUsed/2",
  "VALUE_NOT_IN_LIST:/images/0/mimeType",
  "UNUSED_OBJECT:/images/0",
  "IMAGE_UNRECOGNIZED_FORMAT:/images/0",
]);
const unexpectedValidatorIssues = validator.issues.messages.filter(
  (issue) => !allowedValidatorIssues.has(`${issue.code}:${issue.pointer}`),
);
assert.deepEqual(
  unexpectedValidatorIssues,
  [],
  `Unexpected validator issues: ${JSON.stringify(unexpectedValidatorIssues, null, 2)}`,
);

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions([KHRTextureBasisu, KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const document = await io.readBinary(glb);
const root = document.getRoot();
const nodes = root.listNodes();
const nodesByName = new Map(nodes.map((node) => [node.getName(), node]));
assert.equal(nodesByName.size, nodes.length, "Every generated bike node must have a unique name");

function requiredNode(name) {
  const node = nodesByName.get(name);
  assert(node, `Decoded document is missing required node ${name}`);
  return node;
}

function nodeMaterialName(node) {
  const primitives = node.getMesh()?.listPrimitives() ?? [];
  assert.equal(primitives.length, 1, `${node.getName()} must contain exactly one primitive`);
  return primitives[0].getMaterial()?.getName();
}

const requiredMaterials = [
  "FestivalTeal",
  "FestivalCoral",
  "FestivalNavy",
  "FestivalCream",
  "TireRubber",
  "BrushedMetal",
  "FestivalBoltPlate",
];
const materialsByName = new Map(root.listMaterials().map((material) => [material.getName(), material]));
for (const name of requiredMaterials) {
  assert(materialsByName.has(name), `Decoded document is missing required material ${name}`);
}

for (const suffix of ["Front", "Rear"]) {
  const wheel = requiredNode(`${suffix}Tire`);
  assert.equal(wheel.getMesh(), null, `${suffix}Tire must remain the animated wheel assembly root`);
  const childNames = new Set(wheel.listChildren().map((child) => child.getName()));
  for (const name of [`${suffix}TireRing`, `${suffix}TreadRing`, `${suffix}Hub`, `${suffix}BrakeDisc`]) {
    assert(childNames.has(name), `${suffix}Tire is missing child ${name}`);
  }
  const treadRing = requiredNode(`${suffix}TreadRing`);
  assert.equal(treadRing.getExtras().blockCount, 14, `${suffix}TreadRing block count`);
  assert.equal(
    treadRing.getMesh()?.listPrimitives()[0]?.getAttribute("POSITION")?.getCount(),
    336,
    `${suffix}TreadRing must contain the merged geometry of 14 box blocks`,
  );
  assert.equal(nodeMaterialName(requiredNode(`${suffix}TireRing`)), "TireRubber");
  assert.equal(nodeMaterialName(treadRing), "TireRubber");
  assert.equal(nodeMaterialName(requiredNode(`${suffix}Hub`)), "BrushedMetal");
  assert.equal(nodeMaterialName(requiredNode(`${suffix}BrakeDisc`)), "BrushedMetal");
}

for (const name of ["LeftSidePanel", "RightSidePanel"]) {
  assert.equal(nodeMaterialName(requiredNode(name)), "FestivalCoral", `${name} material`);
}
assert.equal(nodeMaterialName(requiredNode("NumberPlate")), "FestivalBoltPlate");
assert.equal(nodeMaterialName(requiredNode("RearNumberPanel")), "FestivalBoltPlate");
const rearNumber = requiredNode("RearNumber22");
assert.equal(rearNumber.getExtras().glyph, "22", "Rear number glyph");
assert.equal(rearNumber.getExtras().segmentCount, 10, "Rear number segment count");
assert.equal(nodeMaterialName(rearNumber), "FestivalCream", "Rear number material");
assert.equal(
  rearNumber.getMesh()?.listPrimitives()[0]?.getAttribute("POSITION")?.getCount(),
  240,
  "Rear number 22 must contain one merged mesh with ten box segments",
);

const rearWheelPosition = requiredNode("RearTire").getWorldTranslation();
const rearPanelPosition = requiredNode("RearNumberPanel").getWorldTranslation();
assert(rearPanelPosition[1] > 1, "Rear number panel must remain above the rear tire");
assert(
  rearPanelPosition[2] > rearWheelPosition[2] + 0.3,
  "Rear number panel must remain readable from the follow camera",
);
const exhaustPosition = requiredNode("ExhaustCanister").getWorldTranslation();
const exhaustTipPosition = requiredNode("ExhaustTip").getWorldTranslation();
assert(exhaustPosition[0] > 0.35 && exhaustPosition[2] > 0.6, "Exhaust must remain exposed on the rear-right silhouette");
assert(exhaustTipPosition[2] > exhaustPosition[2] + 0.35, "Exhaust tip must extend behind the canister");
assert.equal(nodeMaterialName(requiredNode("ExhaustCanister")), "BrushedMetal");
assert.equal(nodeMaterialName(requiredNode("ExhaustTip")), "FestivalNavy");

const plateMaterial = materialsByName.get("FestivalBoltPlate");
assert(plateMaterial?.getBaseColorTexture(), "FestivalBoltPlate must retain its generated albedo texture");
const meshBearingNodeCount = nodes.filter((node) => node.getMesh()).length;
assert(nodes.length >= 34, "Decoded document is missing detailed bike composition nodes");
assert(meshBearingNodeCount <= 30, "Generated bike exceeds its focal draw-node budget");
assert(root.listMeshes().length >= 15, "Decoded document is missing detailed bike meshes");
assert.equal(root.listTextures()[0]?.getMimeType(), "image/ktx2");

console.log(JSON.stringify({
  manifest: {
    bytes: manifestBytes.byteLength,
    sha256: sha256(manifestBytes),
  },
  glbBytes: glb.byteLength,
  glbSha256: sha256(glb),
  textureBytes: ktx2.byteLength,
  textureSha256: sha256(ktx2),
  meshoptBufferViews: meshoptViews.length,
  requiredExtensions: [...required].sort(),
  ktx2: ktx,
  validator: {
    errors: validator.issues.numErrors,
    warnings: validator.issues.numWarnings,
    infos: validator.issues.numInfos,
    hints: validator.issues.numHints,
    expectedIssueCodes: validator.issues.messages.map((issue) => issue.code),
  },
  decoded: {
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    meshBearingNodes: meshBearingNodeCount,
    frontTreadBlocks: requiredNode("FrontTreadRing").getExtras().blockCount,
    rearTreadBlocks: requiredNode("RearTreadRing").getExtras().blockCount,
    rearNumberSegments: rearNumber.getExtras().segmentCount,
  },
}, null, 2));
