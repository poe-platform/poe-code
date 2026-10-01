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
  if (size >= 1000) {
    const units = ["kB", "MB", "GB", "TB", "PB"];
    const exponent = Math.min(units.length, Math.floor(Math.log10(size) / 3));
    formatted = String(Number((size / 1000 ** exponent).toPrecision(3))) + " " + units[exponent - 1];
  }
  values.push(["FileSize", numeric ? String(size) : formatted, "System"]);
  const type = metadata.find(tag => tag.name === "FileType")?.value ?? (metadata.some(tag => tag.name === "PDFVersion") ? "PDF" : undefined);
  if (type) values.push(["FileTypeExtension", type === "JPEG" ? "jpg" : type.toLowerCase(), "File"]);
  return values.map(([name, value, group]) => ({
    name, rawName: name, value, group, chunkType: "System", index: -1, instance: 0, offset: 0,
    raw: new TextEncoder().encode(value),
  }));
}
