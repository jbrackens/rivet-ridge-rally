import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = "89504e470d0a1a0a";
const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const SUPPORTED_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const CHANNELS_BY_COLOR_TYPE = new Map([
  [2, 3],
  [6, 4],
]);

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function assertPng(condition, message) {
  if (!condition) throw new Error(message);
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function inspectPngIntegrity(bytes, label, expected = {}) {
  const data = Buffer.from(bytes);
  assertPng(data.byteLength >= 45, `${label} is too short to be a complete PNG`);
  assertPng(data.subarray(0, 8).toString("hex") === PNG_SIGNATURE, `${label} PNG signature`);

  let offset = 8;
  let ihdr = null;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawEnd = false;
  const imageData = [];

  while (offset < data.byteLength) {
    assertPng(offset + 12 <= data.byteLength, `${label} has a truncated PNG chunk header`);
    const length = data.readUInt32BE(offset);
    const typeBytes = data.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    assertPng(/^[A-Za-z]{4}$/u.test(type), `${label} has an invalid PNG chunk type`);
    assertPng((typeBytes[2] & 0x20) === 0, `${label} ${type} has an invalid reserved chunk bit`);
    assertPng(
      (typeBytes[0] & 0x20) !== 0 || SUPPORTED_CRITICAL_CHUNKS.has(type),
      `${label} contains unsupported critical chunk ${type}`,
    );
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + length;
    const nextOffset = payloadEnd + 4;
    assertPng(payloadEnd >= payloadStart && nextOffset <= data.byteLength, `${label} ${type} chunk bounds`);
    const payload = data.subarray(payloadStart, payloadEnd);
    const expectedCrc = data.readUInt32BE(payloadEnd);
    const actualCrc = crc32(Buffer.concat([typeBytes, payload]));
    assertPng(actualCrc === expectedCrc, `${label} ${type} chunk CRC`);

    if (offset === 8) assertPng(type === "IHDR", `${label} must begin with IHDR`);
    if (type === "IHDR") {
      assertPng(ihdr === null && length === 13, `${label} must contain one 13-byte IHDR`);
      ihdr = {
        width: payload.readUInt32BE(0),
        height: payload.readUInt32BE(4),
        bitDepth: payload[8],
        colorType: payload[9],
        compression: payload[10],
        filter: payload[11],
        interlace: payload[12],
      };
    } else if (type === "IDAT") {
      assertPng(ihdr !== null && !imageDataEnded && length > 0, `${label} IDAT sequence`);
      sawImageData = true;
      imageData.push(payload);
    } else if (sawImageData && type !== "IEND") {
      imageDataEnded = true;
    }

    offset = nextOffset;
    if (type === "IEND") {
      assertPng(length === 0 && !sawEnd, `${label} IEND chunk`);
      sawEnd = true;
      break;
    }
  }

  assertPng(ihdr !== null, `${label} is missing IHDR`);
  assertPng(sawImageData, `${label} is missing IDAT image data`);
  assertPng(sawEnd && offset === data.byteLength, `${label} must end exactly after IEND`);
  assertPng(ihdr.width > 0 && ihdr.height > 0, `${label} dimensions`);
  assertPng(ihdr.bitDepth === 8, `${label} must use 8-bit samples`);
  const channels = CHANNELS_BY_COLOR_TYPE.get(ihdr.colorType);
  assertPng(channels !== undefined, `${label} must use opaque RGB or RGBA color`);
  assertPng(
    ihdr.compression === 0 && ihdr.filter === 0 && ihdr.interlace === 0,
    `${label} must use standard non-interlaced PNG encoding`,
  );

  const metadata = {
    width: ihdr.width,
    height: ihdr.height,
    bitDepth: ihdr.bitDepth,
    colorType: ihdr.colorType,
  };
  for (const [key, value] of Object.entries(expected)) {
    assertPng(metadata[key] === value, `${label} ${key}: expected ${value}, received ${metadata[key]}`);
  }

  const scanlineBytes = ihdr.width * channels;
  const expectedInflatedBytes = ihdr.height * (scanlineBytes + 1);
  assertPng(Number.isSafeInteger(expectedInflatedBytes), `${label} decoded size`);
  assertPng(expectedInflatedBytes <= MAX_DECODED_BYTES, `${label} decoded size exceeds safety limit`);
  const inflated = inflateSync(Buffer.concat(imageData), {
    maxOutputLength: expectedInflatedBytes + 1,
  });
  assertPng(inflated.byteLength === expectedInflatedBytes, `${label} decoded scanline size`);
  for (let row = 0; row < ihdr.height; row += 1) {
    assertPng(inflated[row * (scanlineBytes + 1)] <= 4, `${label} row ${row} filter type`);
  }

  return metadata;
}
