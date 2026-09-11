import { classify } from "../file/classify.js";

const extensions: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", heic: "image/heic", heif: "image/heif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", aac: "audio/aac", m4a: "audio/mp4", aiff: "audio/aiff",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo", ogv: "video/ogg", mpeg: "video/mpeg", mpg: "video/mpeg",
  pdf: "application/pdf", json: "application/json", zip: "application/zip", gz: "application/gzip",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", html: "text/html", xml: "application/xml",
};

function ebmlInteger(bytes: Uint8Array, offset: number, retainMarker = false): { value: number; width: number } | undefined {
  const first = bytes[offset];
  if (!first) return undefined;
  let marker = 128, width = 1;
  while (!(first & marker)) { marker >>= 1; width++; }
  if (offset + width > bytes.length) return undefined;
  let value = retainMarker ? first : first & (marker - 1);
  for (let index = 1; index < width; index++) value = value * 256 + bytes[offset + index]!;
  if (!Number.isSafeInteger(value) || !retainMarker && value === 2 ** (7 * width) - 1) return undefined;
  return { value, width };
}

function ebmlMimeType(bytes: Uint8Array): string | undefined {
  const header = ebmlInteger(bytes, 4);
  if (!header) return undefined;
  let offset = 4 + header.width;
  const end = Math.min(bytes.length, offset + header.value, 4096);
  while (offset < end) {
    const identifier = ebmlInteger(bytes, offset, true);
    if (!identifier) return undefined;
    offset += identifier.width;
    const size = ebmlInteger(bytes, offset);
    if (!size) return undefined;
    offset += size.width;
    if (size.value > end - offset) return undefined;
    if (identifier.value === 0x4282) {
      const docType = new TextDecoder().decode(bytes.subarray(offset, offset + size.value)).split("\0", 1)[0];
      if (docType === "webm") return "video/webm";
      if (docType === "matroska") return "video/x-matroska";
      return undefined;
    }
    offset += size.value;
  }
  return undefined;
}

export function sniffMimeType(path: string, bytes: Uint8Array): string {
  const matches = (signature: readonly number[], offset = 0): boolean =>
    bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
  const ascii = (offset: number, text: string): boolean =>
    bytes.length >= offset + text.length && [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  if (matches([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (matches([255, 216, 255])) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF")) {
    if (ascii(8, "WEBP")) return "image/webp";
    if (ascii(8, "WAVE")) return "audio/wav";
    if (ascii(8, "AVI ")) return "video/x-msvideo";
  }
  if (ascii(0, "fLaC")) return "audio/flac";
  if (ascii(0, "OggS")) {
    const packet = 27 + (bytes[26] ?? 0);
    if (bytes[26] && bytes[packet] === 0x80 && ascii(packet + 1, "theora")) return "video/ogg";
    return "audio/ogg";
  }
  if (ascii(0, "ID3") || bytes.length >= 2 && bytes[0] === 255 && (bytes[1]! & 0xe0) === 0xe0 && (bytes[1]! & 0x06) !== 0) return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 255 && (bytes[1]! & 0xf6) === 0xf0) return "audio/aac";
  if (ascii(0, "FORM") && (ascii(8, "AIFF") || ascii(8, "AIFC"))) return "audio/aiff";
  if (ascii(4, "ftyp")) {
    if (ascii(8, "avif") || ascii(8, "avis")) return "image/avif";
    if (ascii(8, "heic") || ascii(8, "heix")) return "image/heic";
    if (ascii(8, "mif1") || ascii(8, "msf1")) return "image/heif";
    if (ascii(8, "M4A ") || ascii(8, "M4B ")) return "audio/mp4";
    if (ascii(8, "qt  ")) return "video/quicktime";
    return "video/mp4";
  }
  if (matches([0x1a, 0x45, 0xdf, 0xa3])) {
    const mimeType = ebmlMimeType(bytes);
    if (mimeType) return mimeType;
  }
  if (ascii(0, "%PDF-")) return "application/pdf";
  if (matches([0x50, 0x4b, 3, 4]) || matches([0x50, 0x4b, 5, 6])) return "application/zip";
  if (matches([0x1f, 0x8b])) return "application/gzip";
  if (matches([0x49, 0x49, 42, 0]) || matches([0x4d, 0x4d, 0, 42])) return "image/tiff";
  if (ascii(0, "BM")) return "image/bmp";
  const prefix = bytes.subarray(0, 512);
  const classified = classify(prefix, bytes.length <= prefix.length).mime;
  if (!["application/octet-stream", "text/plain", "inode/x-empty"].includes(classified)) return classified;
  const filename = path.slice(path.lastIndexOf("/") + 1);
  const dot = filename.lastIndexOf(".");
  const extension = dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
  return Object.hasOwn(extensions, extension) ? extensions[extension]! : classified === "inode/x-empty" ? "application/octet-stream" : classified;
}

export function acceptsMimeType(types: readonly string[], mimeType: string): boolean {
  if ([...mimeType].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return false;
  const mime = mimeType.split(";", 1)[0]!.trim().toLowerCase();
  const parts = mime.split("/");
  if (parts.length !== 2 || parts.some(part => !part || [...part].some(character =>
    !(character >= "a" && character <= "z" || character >= "0" && character <= "9" || "!#$%&'+-.^_`|~".includes(character))))) return false;
  return types.some(type => {
    const accepted = type.toLowerCase();
    return accepted === mime || accepted.endsWith("/*") && accepted.slice(0, -2) === parts[0];
  });
}
