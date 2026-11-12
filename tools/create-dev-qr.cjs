// Generate a PNG using the QR encoder already bundled with the installed
// EAS CLI; no additional app dependency or external QR service is needed.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const QRCode = require("../.config/npm/node_global/lib/node_modules/eas-cli/node_modules/qrcode-terminal/vendor/QRCode");

const [url, output] = process.argv.slice(2);
if (!url || !output) throw new Error("Usage: node tools/create-dev-qr.cjs URL output.png");
const qr = new QRCode(-1, 1); // Error correction level L.
qr.addData(url);
qr.make();
const scale = 8;
const margin = 4;
const size = (qr.getModuleCount() + margin * 2) * scale;
const raw = Buffer.alloc(size * (size * 3 + 1), 255);
for (let y = 0; y < size; y++) {
  raw[y * (size * 3 + 1)] = 0;
  for (let x = 0; x < size; x++) {
    const row = Math.floor(y / scale) - margin;
    const col = Math.floor(x / scale) - margin;
    if (row >= 0 && col >= 0 && row < qr.getModuleCount() && col < qr.getModuleCount() && qr.isDark(row, col)) {
      const offset = y * (size * 3 + 1) + x * 3 + 1;
      raw.fill(0, offset, offset + 3);
    }
  }
}
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const buffer = Buffer.alloc(data.length + 12);
  buffer.writeUInt32BE(data.length);
  buffer.write(type, 4);
  data.copy(buffer, 8);
  buffer.writeUInt32BE(crc32(buffer.subarray(4, data.length + 8)), data.length + 8);
  return buffer;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, png);
console.log(output);
