"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const MAX_CRX_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

function parseWebStoreExtensionId(raw) {
  let url;
  try { url = new URL(String(raw || "").trim()); }
  catch { throw new Error("Pegá una URL válida de Chrome Web Store."); }
  if (url.protocol !== "https:" ||
      !["chromewebstore.google.com", "chrome.google.com"].includes(url.hostname) ||
      url.username || url.password || url.port) {
    throw new Error("Por seguridad, solo se aceptan URLs HTTPS oficiales de Chrome Web Store.");
  }
  const match = url.pathname.match(/^\/detail\/(?:[^/]+\/)?([a-p]{32})\/?$/);
  if (!match) throw new Error("No pude extraer un ID de extensión válido de esa ficha de Chrome Web Store.");
  return match[1];
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function extractCrx(buffer, targetDir) {
  const bytes = Buffer.from(buffer);
  if (bytes.length > MAX_CRX_BYTES) throw new Error("El paquete supera el límite de descarga de 100 MB.");
  if (bytes.length < 16 || bytes.toString("ascii", 0, 4) !== "Cr24") throw new Error("Google no devolvió un paquete CRX válido.");

  const version = bytes.readUInt32LE(4);
  let zipOffset;
  if (version === 3) zipOffset = 12 + bytes.readUInt32LE(8);
  else if (version === 2) zipOffset = 16 + bytes.readUInt32LE(8) + bytes.readUInt32LE(12);
  else throw new Error("Formato CRX no compatible: " + version + ".");
  if (zipOffset < 0 || zipOffset + 4 > bytes.length || bytes.toString("binary", zipOffset, zipOffset + 4) !== "PK\x03\x04") {
    throw new Error("El paquete CRX no contiene un ZIP válido.");
  }

  const lowerBound = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= lowerBound; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("No se encontró el directorio ZIP del paquete.");
  const entries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff ||
      entries > 5000 || zipOffset + centralOffset + centralSize > eocd) {
    throw new Error("El ZIP usa una estructura no compatible o supera los límites.");
  }

  await fs.promises.mkdir(targetDir, { recursive: true });
  let cursor = zipOffset + centralOffset;
  let totalExpanded = 0;
  let written = 0;

  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Directorio ZIP dañado.");
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const expectedCrc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const expandedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;

    if ((flags & 1) || ![0, 8].includes(method) ||
        compressedSize === 0xffffffff || expandedSize === 0xffffffff ||
        expandedSize > MAX_FILE_BYTES) {
      throw new Error("El paquete contiene un archivo cifrado, no compatible o demasiado grande.");
    }

    const normalized = name.replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) ||
        normalized.includes("\0") || normalized.split("/").some(part => part === ".." || part === ".")) {
      throw new Error("El paquete contiene una ruta insegura.");
    }
    const outputPath = path.resolve(targetDir, ...normalized.split("/"));
    if (outputPath !== targetDir && !outputPath.startsWith(targetDir + path.sep)) {
      throw new Error("Se bloqueó una ruta ZIP fuera de la carpeta de extensión.");
    }
    const unixMode = (externalAttributes >>> 16) & 0xf000;
    if (unixMode === 0xa000) throw new Error("El paquete contiene enlaces simbólicos, que QBIT no admite.");

    if (normalized.endsWith("/")) {
      await fs.promises.mkdir(outputPath, { recursive: true });
      continue;
    }
    const absoluteLocalOffset = zipOffset + localOffset;
    if (absoluteLocalOffset + 30 > bytes.length || bytes.readUInt32LE(absoluteLocalOffset) !== 0x04034b50) {
      throw new Error("Entrada ZIP local dañada.");
    }
    const localNameLength = bytes.readUInt16LE(absoluteLocalOffset + 26);
    const localExtraLength = bytes.readUInt16LE(absoluteLocalOffset + 28);
    const dataStart = absoluteLocalOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error("Datos ZIP incompletos.");

    const packed = bytes.subarray(dataStart, dataEnd);
    const file = method === 0 ? Buffer.from(packed) :
      zlib.inflateRawSync(packed, { maxOutputLength: MAX_FILE_BYTES });
    if (file.length !== expandedSize || crc32(file) !== expectedCrc) {
      throw new Error("Falló la verificación de integridad de un archivo del paquete.");
    }
    totalExpanded += file.length;
    if (totalExpanded > MAX_TOTAL_BYTES) throw new Error("La extensión supera el límite de extracción de 200 MB.");
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, file, { flag: "wx" });
    written++;
  }

  if (!written || !fs.existsSync(path.join(targetDir, "manifest.json"))) {
    throw new Error("El paquete no contiene un manifest.json en su carpeta raíz.");
  }
}

async function downloadWebStoreExtension(id, targetDir, chromeVersion) {
  const query = new URLSearchParams({
    response: "redirect",
    prodversion: String(chromeVersion || "120.0.0.0"),
    acceptformat: "crx2,crx3",
    x: "id=" + id + "&installsource=ondemand&uc"
  });
  const response = await fetch("https://clients2.google.com/service/update2/crx?" + query.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error("Google no pudo descargar la extensión (HTTP " + response.status + ").");
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_CRX_BYTES) throw new Error("El paquete supera el límite de descarga de 100 MB.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_CRX_BYTES) throw new Error("El paquete supera el límite de descarga de 100 MB.");

  const parent = path.dirname(targetDir);
  const temporary = path.join(parent, "." + id + "-" + crypto.randomUUID() + ".tmp");
  await fs.promises.mkdir(parent, { recursive: true });
  try {
    await extractCrx(buffer, temporary);
    return { temporary, manifest: JSON.parse(await fs.promises.readFile(path.join(temporary, "manifest.json"), "utf8")) };
  } catch (error) {
    await fs.promises.rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { parseWebStoreExtensionId, downloadWebStoreExtension };
