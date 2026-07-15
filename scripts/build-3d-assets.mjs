import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Document, NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
  KHRTextureBasisu,
} from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { encodeToKTX2 } from "ktx2-encoder";
import { MeshoptEncoder } from "meshoptimizer";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Quaternion,
  TorusGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIR = path.join(ROOT, "public/assets/3d");
const TRANSCODER_DIR = path.join(ROOT, "public/assets/transcoders/basis");
const MODEL_PATH = path.join(MODEL_DIR, "festival-trail-bike.glb");
const TEXTURE_PATH = path.join(MODEL_DIR, "festival-bike-albedo.ktx2");
const MANIFEST_PATH = path.join(MODEL_DIR, "asset-manifest.json");
const TEXTURE_SIZE = 128;
const BASIS_NOTICE = `NOTICE
Basis Universal™ Supercompressed GPU Texture Compression Library
Copyright © 2016–2026 Binomial LLC. All rights reserved except as granted under the Apache 2.0 license.
"Basis Universal" is a trademark of Binomial LLC.
The documents in the Basis Universal wiki, and the Basis Universal library, example, and tool source code, fall under the Apache 2.0 license, unless otherwise explicitly indicated.

Redistributions or derivative works must include a readable copy of the attribution notices from this NOTICE file (see Apache License 2.0 §4(d)).
If you modify the Basis Universal source code, specifications, or wiki documents and redistribute the files, you must cause any modified files to carry prominent notices stating that you changed the files (see Apache 2.0 §4(b)).
This software, documentation and specifications are provided "as is", without warranty of any kind (see Apache 2.0 §§7–8).
`;

const packageManifest = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function copyTypedArray(array) {
  return new array.constructor(array);
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[previous];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function createAlbedoPixels() {
  const data = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const lightning = [
    [69, 17], [38, 69], [59, 69], [47, 111], [91, 56], [70, 56], [85, 17],
  ];

  for (let y = 0; y < TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < TEXTURE_SIZE; x += 1) {
      const offset = (y * TEXTURE_SIZE + x) * 4;
      const border = x < 8 || y < 8 || x >= 120 || y >= 120;
      const stripe = (x + y) % 32 < 7;
      const bolt = pointInPolygon(x, y, lightning);
      const color = bolt
        ? [255, 210, 63]
        : border
          ? [241, 95, 80]
          : stripe
            ? [12, 123, 128]
            : [34, 207, 204];
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }

  return data;
}

function validateKTX2(bytes) {
  const expectedIdentifier = "ab4b5458203230bb0d0a1a0a";
  const header = Buffer.from(bytes);
  assert(header.subarray(0, 12).toString("hex") === expectedIdentifier, "KTX2 identifier is invalid");
  assert(header.readUInt32LE(12) === 0, "Basis KTX2 must use vkFormat 0");
  assert(header.readUInt32LE(20) === TEXTURE_SIZE, "Unexpected KTX2 width");
  assert(header.readUInt32LE(24) === TEXTURE_SIZE, "Unexpected KTX2 height");
  assert(header.readUInt32LE(36) === 1, "KTX2 must contain one face");
  assert(header.readUInt32LE(40) === 8, "KTX2 must contain a complete 128px mip chain");
  assert(header.readUInt32LE(44) === 1, "KTX2 must use BasisLZ supercompression");
  const dfdOffset = header.readUInt32LE(48);
  assert(dfdOffset + 16 <= header.byteLength, "KTX2 data format descriptor is out of bounds");
  assert(header[dfdOffset + 12] === 163, "KTX2 data format must be ETC1S");
  assert(header[dfdOffset + 13] === 1, "KTX2 color primaries must be BT.709");
  assert(header[dfdOffset + 14] === 2, "KTX2 transfer function must be sRGB");
}

async function createKTX2Texture() {
  const pixels = createAlbedoPixels();
  const encoded = await encodeToKTX2(new Uint8Array(), {
    imageDecoder: async () => ({ width: TEXTURE_SIZE, height: TEXTURE_SIZE, data: pixels }),
    isUASTC: false,
    isKTX2File: true,
    isYFlip: false,
    isPerceptual: true,
    isSetKTX2SRGBTransferFunc: true,
    generateMipmap: true,
    qualityLevel: 180,
    compressionLevel: 2,
    enableDebug: false,
  });
  const bytes = new Uint8Array(encoded);
  validateKTX2(bytes);
  return bytes;
}

function colorFactor(hex) {
  const color = new Color(hex);
  return [color.r, color.g, color.b, 1];
}

function mergeGeometryParts(name, geometries) {
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  assert(merged, `Could not merge ${name} geometry`);
  return merged;
}

function createBikeDocument(ktx2Bytes) {
  const document = new Document();
  const buffer = document.createBuffer("FestivalTrailBikeBuffer");
  const scene = document.createScene("FestivalTrailBikeScene");
  const bike = document.createNode("FestivalTrailBike");
  scene.addChild(bike);

  const texture = document
    .createTexture("FestivalBoltAlbedo_ETC1S")
    .setImage(ktx2Bytes)
    .setMimeType("image/ktx2");
  document.createExtension(KHRTextureBasisu).setRequired(true);

  function material(name, hex, roughness, metalness = 0) {
    return document
      .createMaterial(name)
      .setBaseColorFactor(colorFactor(hex))
      .setRoughnessFactor(roughness)
      .setMetallicFactor(metalness);
  }

  const teal = material("FestivalTeal", 0x22cfcc, 0.58);
  const coral = material("FestivalCoral", 0xf15f50, 0.62);
  const navy = material("FestivalNavy", 0x061c32, 0.72);
  const cream = material("FestivalCream", 0xf7eddb, 0.66);
  const rubber = material("TireRubber", 0x15191d, 0.96);
  const metal = material("BrushedMetal", 0x7e8990, 0.34, 0.72);
  const plate = document
    .createMaterial("FestivalBoltPlate")
    .setBaseColorFactor([1, 1, 1, 1])
    .setBaseColorTexture(texture)
    .setRoughnessFactor(0.56)
    .setMetallicFactor(0.03);

  function meshFromGeometry(name, geometry, meshMaterial) {
    const primitive = document.createPrimitive().setMaterial(meshMaterial);
    const attributes = [
      ["POSITION", "position", "VEC3"],
      ["NORMAL", "normal", "VEC3"],
    ];
    if (meshMaterial === plate) attributes.push(["TEXCOORD_0", "uv", "VEC2"]);

    for (const [semantic, attributeName, type] of attributes) {
      const attribute = geometry.getAttribute(attributeName);
      if (!attribute) continue;
      primitive.setAttribute(
        semantic,
        document
          .createAccessor(`${name}_${semantic}`)
          .setType(type)
          .setArray(copyTypedArray(attribute.array))
          .setBuffer(buffer),
      );
    }

    const index = geometry.getIndex();
    if (index) {
      primitive.setIndices(
        document
          .createAccessor(`${name}_INDICES`)
          .setType("SCALAR")
          .setArray(copyTypedArray(index.array))
          .setBuffer(buffer),
      );
    }

    geometry.dispose();
    return document.createMesh(name).addPrimitive(primitive);
  }

  const boxTeal = meshFromGeometry("BoxTeal", new BoxGeometry(1, 1, 1), teal);
  const boxCoral = meshFromGeometry("BoxCoral", new BoxGeometry(1, 1, 1), coral);
  const boxNavy = meshFromGeometry("BoxNavy", new BoxGeometry(1, 1, 1), navy);
  const boxMetal = meshFromGeometry("BoxMetal", new BoxGeometry(1, 1, 1), metal);
  const boxPlate = meshFromGeometry("BoxPlate", new BoxGeometry(1, 1, 1), plate);
  const rearFenderMesh = meshFromGeometry(
    "RearFenderShell",
    new BoxGeometry(1, 1, 1),
    coral,
  );
  const tireMesh = meshFromGeometry(
    "Tire",
    new TorusGeometry(0.4, 0.12, 6, 14),
    rubber,
  );
  const treadRingGeometry = mergeGeometryParts(
    "14-block tread ring",
    Array.from({ length: 14 }, (_, index) => {
      const angle = (index / 14) * Math.PI * 2;
      const geometry = new BoxGeometry(0.34, 0.13, 0.19);
      geometry.rotateX(angle);
      geometry.translate(0, Math.cos(angle) * 0.53, Math.sin(angle) * 0.53);
      return geometry;
    }),
  );
  const treadRingMesh = meshFromGeometry("TreadRing14", treadRingGeometry, rubber);
  const hubMesh = meshFromGeometry(
    "WheelHub",
    new CylinderGeometry(0.18, 0.18, 0.3, 10, 1, false),
    metal,
  );
  const brakeDiscMesh = meshFromGeometry(
    "BrakeDisc",
    new CylinderGeometry(0.26, 0.26, 0.035, 12, 1, false),
    metal,
  );
  const tankMesh = meshFromGeometry(
    "TankShell",
    new IcosahedronGeometry(0.5, 1),
    coral,
  );
  const exhaustMesh = meshFromGeometry(
    "ExhaustCanister",
    new CylinderGeometry(0.11, 0.145, 0.72, 10, 1, false),
    metal,
  );
  const exhaustTipMesh = meshFromGeometry(
    "ExhaustTip",
    new CylinderGeometry(0.075, 0.12, 0.18, 10, 1, false),
    navy,
  );
  const headlightMesh = meshFromGeometry(
    "Headlight",
    new IcosahedronGeometry(0.18, 0),
    coral,
  );

  function addPart(name, partMesh, options = {}) {
    const node = document.createNode(name).setMesh(partMesh);
    if (options.translation) node.setTranslation(options.translation);
    if (options.scale) node.setScale(options.scale);
    if (options.rotation) {
      const quaternion = new Quaternion().setFromEuler(new Euler(...options.rotation));
      node.setRotation([quaternion.x, quaternion.y, quaternion.z, quaternion.w]);
    }
    (options.parent ?? bike).addChild(node);
    return node;
  }

  for (const z of [-0.98, 0.98]) {
    const suffix = z < 0 ? "Front" : "Rear";
    const wheel = document.createNode(`${suffix}Tire`).setTranslation([0, 0.52, z]);
    bike.addChild(wheel);
    addPart(`${suffix}TireRing`, tireMesh, {
      parent: wheel,
      rotation: [0, Math.PI / 2, 0],
    });
    addPart(`${suffix}Hub`, hubMesh, {
      parent: wheel,
      rotation: [0, 0, Math.PI / 2],
    });
    addPart(`${suffix}BrakeDisc`, brakeDiscMesh, {
      parent: wheel,
      translation: [0.17, 0, 0],
      rotation: [0, 0, Math.PI / 2],
    });
    addPart(`${suffix}TreadRing`, treadRingMesh, { parent: wheel })
      .setExtras({ blockCount: 14 });
  }

  addPart("MainFrame", boxTeal, { translation: [0, 0.82, 0.05], scale: [0.28, 0.24, 1.32], rotation: [-0.06, 0, 0] });
  addPart("Tank", tankMesh, { translation: [0, 1.03, -0.22], scale: [0.66, 0.48, 0.78], rotation: [-0.08, 0, 0] });
  addPart("Seat", boxNavy, { translation: [0, 1.19, 0.45], scale: [0.48, 0.16, 0.62], rotation: [0.04, 0, 0] });
  addPart("RearFender", rearFenderMesh, { translation: [0, 1.08, 1], scale: [0.5, 0.09, 0.7], rotation: [0.16, 0, 0] });
  addPart("LeftSidePanel", boxCoral, { translation: [-0.34, 0.93, 0.3], scale: [0.08, 0.4, 0.76], rotation: [-0.08, 0.06, 0] });
  addPart("RightSidePanel", boxCoral, { translation: [0.34, 0.93, 0.3], scale: [0.08, 0.4, 0.76], rotation: [-0.08, -0.06, 0] });
  addPart("FrontFender", boxTeal, { translation: [0, 0.99, -0.94], scale: [0.62, 0.11, 0.74], rotation: [-0.16, 0, 0] });
  addPart("NumberPlate", boxPlate, { translation: [0, 1.27, -0.74], scale: [0.7, 0.62, 0.08], rotation: [-0.16, 0, 0] });
  addPart("Headlight", headlightMesh, { translation: [0, 1.2, -0.84], scale: [1, 0.7, 0.45] });
  addPart("Handlebar", boxMetal, { translation: [0, 1.55, -0.55], scale: [1.08, 0.08, 0.08] });
  addPart("LeftGrip", boxNavy, { translation: [-0.58, 1.55, -0.55], scale: [0.2, 0.13, 0.13] });
  addPart("RightGrip", boxNavy, { translation: [0.58, 1.55, -0.55], scale: [0.2, 0.13, 0.13] });

  for (const x of [-0.23, 0.23]) {
    addPart(`FrontFork_${x < 0 ? "L" : "R"}`, boxMetal, {
      translation: [x, 0.98, -0.76],
      scale: [0.09, 0.92, 0.09],
      rotation: [-0.24, 0, 0],
    });
    addPart(`Swingarm_${x < 0 ? "L" : "R"}`, boxMetal, {
      translation: [x, 0.63, 0.49],
      scale: [0.08, 0.12, 0.98],
      rotation: [0.08, 0, 0],
    });
  }

  addPart("Engine", boxNavy, { translation: [0, 0.64, 0.12], scale: [0.5, 0.42, 0.5] });
  addPart("EngineGuard", boxMetal, { translation: [0, 0.48, 0.1], scale: [0.72, 0.1, 0.66] });
  addPart("ExhaustCanister", exhaustMesh, { translation: [0.45, 0.86, 0.72], rotation: [Math.PI / 2, 0, -0.04] });
  addPart("ExhaustTip", exhaustTipMesh, { translation: [0.45, 0.86, 1.14], rotation: [Math.PI / 2, 0, -0.04] });

  const rearNumberAssembly = document
    .createNode("RearNumberAssembly")
    .setTranslation([0, 1.18, 1.34]);
  const rearNumberRotation = new Quaternion().setFromEuler(new Euler(0.08, 0, 0));
  rearNumberAssembly.setRotation([
    rearNumberRotation.x,
    rearNumberRotation.y,
    rearNumberRotation.z,
    rearNumberRotation.w,
  ]);
  bike.addChild(rearNumberAssembly);
  addPart("RearNumberPanel", boxPlate, {
    parent: rearNumberAssembly,
    scale: [0.72, 0.5, 0.08],
  });

  const rearDigitSegments = [
    ["Top", 0, 0.16, 0.18, 0.052],
    ["UpperRight", 0.065, 0.08, 0.052, 0.15],
    ["Middle", 0, 0, 0.18, 0.052],
    ["LowerLeft", -0.065, -0.08, 0.052, 0.15],
    ["Bottom", 0, -0.16, 0.18, 0.052],
  ];
  const rearNumberGeometry = mergeGeometryParts(
    "rear number 22",
    [["Left", -0.15], ["Right", 0.15]].flatMap(([, centerX]) =>
      rearDigitSegments.map(([, offsetX, offsetY, width, height]) => {
        const geometry = new BoxGeometry(width, height, 0.035);
        geometry.translate(centerX + offsetX, offsetY, 0.06);
        return geometry;
      }),
    ),
  );
  const rearNumberMesh = meshFromGeometry("RearNumber22Segments", rearNumberGeometry, cream);
  addPart("RearNumber22", rearNumberMesh, { parent: rearNumberAssembly })
    .setExtras({ glyph: "22", segmentCount: 10 });

  document.getRoot().setExtras({
    assetSource: "Original procedural project asset",
    generator: "scripts/build-3d-assets.mjs",
  });

  return document;
}

async function copyBasisRuntime() {
  const threeBasis = path.join(ROOT, "node_modules/three/examples/jsm/libs/basis");
  const files = ["basis_transcoder.js", "basis_transcoder.wasm", "README.md"];
  await mkdir(TRANSCODER_DIR, { recursive: true });
  for (const file of files) {
    await copyFile(path.join(threeBasis, file), path.join(TRANSCODER_DIR, file));
  }
  await copyFile(path.join(ROOT, "node_modules/typescript/LICENSE.txt"), path.join(TRANSCODER_DIR, "LICENSE.txt"));
  await writeFile(path.join(TRANSCODER_DIR, "NOTICE.txt"), BASIS_NOTICE);
}

async function fileRecord(relativePath) {
  const bytes = await readFile(path.join(ROOT, relativePath));
  return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

await mkdir(MODEL_DIR, { recursive: true });
const ktx2Bytes = await createKTX2Texture();
await writeFile(TEXTURE_PATH, ktx2Bytes);

await MeshoptEncoder.ready;
const document = createBikeDocument(ktx2Bytes);
const baselineIO = new NodeIO().registerExtensions([KHRTextureBasisu]);
const uncompressedGlb = await baselineIO.writeBinary(document);
await document.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));

const io = new NodeIO()
  .registerExtensions([KHRTextureBasisu, KHRMeshQuantization, EXTMeshoptCompression])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const glb = await io.writeBinary(document);
await writeFile(MODEL_PATH, glb);
await copyBasisRuntime();

const outputPaths = [
  "public/assets/3d/festival-trail-bike.glb",
  "public/assets/3d/festival-bike-albedo.ktx2",
  "public/assets/transcoders/basis/basis_transcoder.js",
  "public/assets/transcoders/basis/basis_transcoder.wasm",
  "public/assets/transcoders/basis/README.md",
  "public/assets/transcoders/basis/LICENSE.txt",
  "public/assets/transcoders/basis/NOTICE.txt",
];
const files = [];
for (const outputPath of outputPaths) files.push(await fileRecord(outputPath));

const manifest = {
  schemaVersion: 1,
  generator: "scripts/build-3d-assets.mjs",
  design: {
    name: "Festival Trail Bike",
    origin: "Original project-authored procedural geometry and texture; no source model or source image",
  },
  compression: {
    geometry: "EXT_meshopt_compression (required, high/filter mode)",
    quantization: "KHR_mesh_quantization (required)",
    uncompressedGlbBytes: uncompressedGlb.byteLength,
    compressedGlbBytes: glb.byteLength,
    glbReductionPercent: Number(((1 - glb.byteLength / uncompressedGlb.byteLength) * 100).toFixed(1)),
    texture: "KTX2 ETC1S with BasisLZ supercompression, sRGB transfer, and 8 mip levels",
    textureDimensions: [TEXTURE_SIZE, TEXTURE_SIZE],
    gltfTextureExtension: "KHR_texture_basisu (required)",
  },
  dependencies: [
    { package: "@gltf-transform/core", version: packageManifest.devDependencies["@gltf-transform/core"], license: "MIT", use: "GLB authoring" },
    { package: "@gltf-transform/extensions", version: packageManifest.devDependencies["@gltf-transform/extensions"], license: "MIT", use: "glTF extension I/O" },
    { package: "@gltf-transform/functions", version: packageManifest.devDependencies["@gltf-transform/functions"], license: "MIT", use: "Meshopt transform" },
    { package: "ktx2-encoder", version: packageManifest.devDependencies["ktx2-encoder"], license: "MIT", use: "Build-time Basis encoder wrapper" },
    { component: "Basis Universal encoder WASM", source: `ktx2-encoder@${packageManifest.devDependencies["ktx2-encoder"]}`, license: "Apache-2.0", use: "Build-time ETC1S encoding" },
    { package: "meshoptimizer", version: packageManifest.devDependencies.meshoptimizer, license: "MIT", use: "Build-time geometry encoder" },
    { package: "gltf-validator", version: packageManifest.devDependencies["gltf-validator"], license: "Apache-2.0", use: "Build-time verification" },
    { package: "three", version: packageManifest.dependencies.three, license: "MIT", use: "Primitive geometry generation and runtime loaders" },
    { component: "Basis Universal transcoder", source: `three@${packageManifest.dependencies.three}/examples/jsm/libs/basis`, license: "Apache-2.0", use: "Runtime KTX2 transcoding" },
  ],
  files,
};

await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Generated ${path.relative(ROOT, MODEL_PATH)} (${glb.byteLength} bytes)`);
console.log(`Meshopt GLB reduction: ${uncompressedGlb.byteLength} -> ${glb.byteLength} bytes`);
console.log(`Generated ${path.relative(ROOT, TEXTURE_PATH)} (${ktx2Bytes.byteLength} bytes)`);
console.log(`Generated ${path.relative(ROOT, MANIFEST_PATH)}`);
