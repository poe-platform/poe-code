import type { Invocation } from "./arguments.js";
import type { MetadataTag } from "./png.js";
import type { Resources } from "./resources.js";

/** Virtual operand paths and inspected bytes only; never consult host metadata. */
export function systemTags(file: string, size: number, metadata: readonly MetadataTag[], invocation: Invocation, resources: Resources): MetadataTag[] {
  resources.admit("work", file.length * 4 + metadata.length + 256);
  resources.admit("decoded", file.length * 2 + 256);
  resources.admit("retained", file.length * 16 + 2048);
  const values: [string, string, string][] = [];
  if (file !== "-") {
    const slash = file.lastIndexOf("/");
    values.push(["FileName", file.slice(slash + 1), "System"], ["Directory", slash < 0 ? "." : file.slice(0, slash) || "/", "System"]);
  }
  const numeric = invocation.numeric || invocation.binary || invocation.valueConvTags.includes("filesize");
  let formatted = String(size) + " bytes";
  if (size >= 2000) {
    const divisor = size < 2000000 ? 1000 : size < 2000000000 ? 1000000 : 1000000000;
    const unit = divisor === 1000 ? "kB" : divisor === 1000000 ? "MB" : "GB";
    const scaled = size / divisor;
    formatted = scaled.toFixed(scaled < 10 ? 1 : 0) + " " + unit;
  }
  values.push(["FileSize", numeric ? String(size) : formatted, "System"]);
  const type = metadata.find(tag => tag.name === "FileType")?.value ?? (metadata.some(tag => tag.name === "PDFVersion") ? "PDF" : undefined);
  if (type) values.push(["FileTypeExtension", type === "JPEG" ? "jpg" : type.toLowerCase(), "File"]);
  return values.map(([name, value, group]) => ({
    name, rawName: name, value, group, chunkType: "System", index: -1, instance: 0, offset: 0,
    raw: new TextEncoder().encode(value),
  }));
}
