import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
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

for (const file of manifest.files) {
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
assert(document.getRoot().listMeshes().length > 0, "Decoded document has no meshes");
assert(document.getRoot().listNodes().length >= 20, "Decoded document is missing bike parts");
assert.equal(document.getRoot().listTextures()[0]?.getMimeType(), "image/ktx2");

console.log(JSON.stringify({
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
    nodes: document.getRoot().listNodes().length,
    meshes: document.getRoot().listMeshes().length,
    materials: document.getRoot().listMaterials().length,
    textures: document.getRoot().listTextures().length,
  },
}, null, 2));
