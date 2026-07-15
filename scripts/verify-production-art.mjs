import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PANORAMA_PATH = path.join(ROOT, "public/assets/art/canyon-festival-panorama.png");
const EXPECTED_BYTES = 1_801_764;
const EXPECTED_SHA256 = "43b39c9075428e9bc081b3d8f216fae0027e889f89caa59586aa6097080b26a5";
const TITLE_ART_ASSETS = [
  {
    path: path.join(ROOT, "public/assets/art/title-background.png"),
    bytes: 2_129_759,
    sha256: "292ffdf20edcb4c483b30a5a4f6882f3ecbaf8ff1f28815d8fe28a9aeb6e3e78",
  },
  {
    path: path.join(ROOT, "docs/design/concepts/title-background-production.png"),
    bytes: 2_129_759,
    sha256: "292ffdf20edcb4c483b30a5a4f6882f3ecbaf8ff1f28815d8fe28a9aeb6e3e78",
  },
];
const APP_ICON = {
  path: path.join(ROOT, "public/assets/icons/app-icon.svg"),
  bytes: 477,
  sha256: "7d55e5fe2392a4d091f962e01e2a09dc6a21def5c1e9886a2bb39bb478f395a5",
};
const FONT_ASSETS = [
  {
    path: path.join(ROOT, "public/assets/fonts/barlow-condensed-700-latin.woff2"),
    bytes: 14_888,
    sha256: "e3e520cb7468f2efd60bc2ce96694567c3312f4ef414fffbe605e3ad146b24e6",
  },
  {
    path: path.join(ROOT, "public/assets/fonts/barlow-condensed-900-latin.woff2"),
    bytes: 13_940,
    sha256: "2036f7f4aacc7759dcf8c6be2bd5bbde873c25a860f24dca0530ad14d4937723",
  },
];
const FONT_LICENSE = {
  path: path.join(ROOT, "docs/licenses/barlow-condensed-OFL-1.1.txt"),
  bytes: 4_377,
  sha256: "186d750eb496a4c17a76385f82be6aea2ac1cf2de074a811d63786cf374ea73f",
};
const SHIPPED_ASSET_DIRECTORIES = [
  {
    path: path.join(ROOT, "public/assets"),
    entries: ["3d", "art", "fonts", "icons", "transcoders"],
    kind: "directory",
  },
  {
    path: path.join(ROOT, "public/assets/art"),
    entries: ["canyon-festival-panorama.png", "title-background.png"],
    kind: "file",
  },
  {
    path: path.join(ROOT, "public/assets/fonts"),
    entries: ["barlow-condensed-700-latin.woff2", "barlow-condensed-900-latin.woff2"],
    kind: "file",
  },
  {
    path: path.join(ROOT, "public/assets/icons"),
    entries: ["app-icon.svg"],
    kind: "file",
  },
  {
    path: path.join(ROOT, "public/assets/transcoders"),
    entries: ["basis"],
    kind: "directory",
  },
];

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function readRegularFile(filePath, label) {
  const metadata = await lstat(filePath);
  assert(metadata.isFile(), `${label} must be a regular file`);
  return readFile(filePath);
}

function inspectPng(data, label) {
  assert.equal(
    data.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    `${label} PNG signature`,
  );

  const chunks = [];
  let offset = 8;
  while (offset + 12 <= data.byteLength) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const nextOffset = offset + 12 + length;
    assert(nextOffset <= data.byteLength, `${type} PNG chunk is out of bounds`);
    chunks.push({ type, length });
    offset = nextOffset;
    if (type === "IEND") break;
  }

  assert.equal(offset, data.byteLength, `${label} PNG must end after its IEND chunk`);
  assert.equal(chunks[0]?.type, "IHDR", `${label} PNG must begin with IHDR`);
  assert.equal(chunks.at(-1)?.type, "IEND", `${label} PNG must end with IEND`);
  assert(chunks.some((chunk) => chunk.type === "IDAT" && chunk.length > 0), `${label} PNG has no image data`);
  assert.equal(chunks.filter((chunk) => chunk.type === "caBX").length, 1, `${label} PNG must retain one C2PA caBX chunk`);

  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colorType: data[25],
    compression: data[26],
    filter: data[27],
    interlace: data[28],
    chunks: chunks.map((chunk) => chunk.type),
  };
}

for (const directory of SHIPPED_ASSET_DIRECTORIES) {
  assert.deepEqual(
    (await readdir(directory.path)).sort(),
    [...directory.entries].sort(),
    `${path.relative(ROOT, directory.path)} must contain exactly the authoritative shipped asset set`,
  );
  for (const entry of directory.entries) {
    const metadata = await lstat(path.join(directory.path, entry));
    assert(
      directory.kind === "file" ? metadata.isFile() : metadata.isDirectory(),
      `${path.relative(ROOT, path.join(directory.path, entry))} must be a regular ${directory.kind}`,
    );
  }
}

const panorama = await readRegularFile(PANORAMA_PATH, "Panorama");
assert.equal(panorama.byteLength, EXPECTED_BYTES, "Panorama byte length");
assert.equal(sha256(panorama), EXPECTED_SHA256, "Panorama SHA-256");

const png = inspectPng(panorama, "Panorama");
assert.deepEqual([png.width, png.height], [1_774, 887], "Panorama dimensions");
assert.equal(png.bitDepth, 8, "Panorama bit depth");
assert.equal(png.colorType, 2, "Panorama must remain opaque truecolor RGB");
assert.equal(png.compression, 0, "Panorama PNG compression method");
assert.equal(png.filter, 0, "Panorama PNG filter method");
assert.equal(png.interlace, 0, "Panorama PNG interlace method");

const provenanceText = panorama.toString("latin1");
for (const marker of [
  "c2pa",
  "gpt-image",
  "OpenAI Media Service API",
  "trainedAlgorithmicMedia",
]) {
  assert(provenanceText.includes(marker), `Panorama provenance marker is missing: ${marker}`);
}

const verifiedTitleArt = [];
let shippedTitle;
for (const titleAsset of TITLE_ART_ASSETS) {
  const data = await readRegularFile(titleAsset.path, path.relative(ROOT, titleAsset.path));
  assert.equal(data.byteLength, titleAsset.bytes, `${path.relative(ROOT, titleAsset.path)} byte length`);
  assert.equal(sha256(data), titleAsset.sha256, `${path.relative(ROOT, titleAsset.path)} SHA-256`);
  shippedTitle ??= data;
  assert.deepEqual(data, shippedTitle, "Shipped and retained source title artwork must remain byte-identical");
  verifiedTitleArt.push({
    path: path.relative(ROOT, titleAsset.path),
    bytes: data.byteLength,
    sha256: sha256(data),
  });
}

const titlePng = inspectPng(shippedTitle, "Title background");
assert.deepEqual([titlePng.width, titlePng.height], [1_672, 941], "Title background dimensions");
assert.equal(titlePng.bitDepth, 8, "Title background bit depth");
assert.equal(titlePng.colorType, 2, "Title background must remain opaque truecolor RGB");
for (const marker of [
  "c2pa",
  "gpt-image",
  "OpenAI Media Service API",
  "trainedAlgorithmicMedia",
]) {
  assert(shippedTitle.includes(marker), `Title background provenance marker is missing: ${marker}`);
}

const appIcon = await readRegularFile(APP_ICON.path, "App icon");
assert.equal(appIcon.byteLength, APP_ICON.bytes, "App icon byte length");
assert.equal(sha256(appIcon), APP_ICON.sha256, "App icon SHA-256");
const appIconText = appIcon.toString("utf8");
assert(appIconText.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), "App icon SVG root");
assert(appIconText.includes('aria-label="Rivet Ridge Rally helmet mark"'), "App icon accessible identity");

const verifiedFonts = [];
for (const fontAsset of FONT_ASSETS) {
  const data = await readRegularFile(fontAsset.path, path.basename(fontAsset.path));
  assert.equal(data.byteLength, fontAsset.bytes, `${path.basename(fontAsset.path)} byte length`);
  assert.equal(sha256(data), fontAsset.sha256, `${path.basename(fontAsset.path)} SHA-256`);
  assert.equal(data.subarray(0, 4).toString("ascii"), "wOF2", `${path.basename(fontAsset.path)} signature`);
  verifiedFonts.push({
    path: path.relative(ROOT, fontAsset.path),
    bytes: data.byteLength,
    sha256: sha256(data),
    format: "WOFF2",
  });
}

const fontLicense = await readRegularFile(FONT_LICENSE.path, "Barlow Condensed license");
assert.equal(fontLicense.byteLength, FONT_LICENSE.bytes, "Barlow Condensed license byte length");
assert.equal(sha256(fontLicense), FONT_LICENSE.sha256, "Barlow Condensed license SHA-256");
const fontLicenseText = fontLicense.toString("utf8");
assert(fontLicenseText.includes("Copyright 2017 The Barlow Project Authors"), "Barlow copyright notice");
assert(fontLicenseText.includes("SIL OPEN FONT LICENSE Version 1.1"), "Barlow OFL 1.1 text");

console.log(JSON.stringify({
  path: path.relative(ROOT, PANORAMA_PATH),
  bytes: panorama.byteLength,
  sha256: sha256(panorama),
  png,
  provenanceMarkers: [
    "c2pa",
    "gpt-image",
    "OpenAI Media Service API",
    "trainedAlgorithmicMedia",
  ],
  titleArt: verifiedTitleArt,
  appIcon: {
    path: path.relative(ROOT, APP_ICON.path),
    bytes: appIcon.byteLength,
    sha256: sha256(appIcon),
    format: "SVG",
  },
  fonts: verifiedFonts,
  fontLicense: {
    path: path.relative(ROOT, FONT_LICENSE.path),
    bytes: fontLicense.byteLength,
    sha256: sha256(fontLicense),
    license: "SIL Open Font License 1.1",
  },
}, null, 2));
