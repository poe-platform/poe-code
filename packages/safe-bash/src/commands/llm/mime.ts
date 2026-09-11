import { classify } from "../file/classify.js";

const extensions: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo",
  pdf: "application/pdf", txt: "text/plain", json: "application/json", csv: "text/csv",
};

export function attachmentMime(bytes: Uint8Array, path: string): string {
  const prefix = bytes.subarray(0, 512);
  const ascii = (offset: number, length: number) => String.fromCharCode(...prefix.subarray(offset, offset + length));
  if (prefix.length >= 7 && prefix[0] === 255 && (prefix[1]! & 246) === 240) return "audio/aac";
  if (ascii(0, 3) === "ID3" || (prefix[0] === 255 && (prefix[1]! & 224) === 224 && (prefix[1]! & 6) !== 0)) return "audio/mpeg";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "RIFF") {
    if (ascii(8, 4) === "WAVE") return "audio/wav";
    if (ascii(8, 4) === "AVI ") return "video/x-msvideo";
  }
  if (ascii(4, 4) === "ftyp") return ascii(8, 4) === "M4A " ? "audio/mp4" : ascii(8, 4) === "qt  " ? "video/quicktime" : "video/mp4";
  const classified = classify(prefix, bytes.length <= prefix.length).mime;
  if (!["application/octet-stream", "text/plain", "inode/x-empty"].includes(classified)) return classified;
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return Object.hasOwn(extensions, extension) ? extensions[extension]! : classified === "inode/x-empty" ? "application/octet-stream" : classified;
}
