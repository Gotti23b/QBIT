const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const source = path.join(process.cwd(), "qbit-icon.svg");
  const output = path.join(process.cwd(), "qbit-icon.ico");
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];

  for (const size of sizes) {
    images.push(await sharp(source)
      .resize(size, size, { fit: "contain" })
      .png()
      .toBuffer());
  }

  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length;
  images.forEach((png, index) => {
    const entry = 6 + index * 16;
    const size = sizes[index];
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  fs.writeFileSync(output, Buffer.concat([header, ...images]));
  console.log("Generated qbit-icon.ico with sizes: " + sizes.join(", "));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
