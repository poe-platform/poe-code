import { parseTemplate, type Invocation } from "./arguments.js";
import type { MetadataTag } from "./png.js";
import type { Resources } from "./resources.js";
import { printable } from "./scalar.js";
import { exiftoolRegistry } from "./registry.js";

export const xmlHeader = "<?xml version='1.0' encoding='UTF-8'?>\n<rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>\n";

export function renderPresentation(file: string, tags: readonly MetadataTag[], invocation: Invocation, resources: Resources): string {
  const extent = file.length + tags.reduce((sum, tag) => sum + tag.name.length + tag.value.length + 128, 0) + (invocation.template?.length ?? 0) + 512;
  resources.admit("work", extent * 16);
  resources.admit("retained", extent * 96);
  const text = (value: string): string => printable(value, { ...resources.limits, signal: resources.signal });
  const xml = (value: string): string => {
    const escapes: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" };
    return Array.from(text(value), character => escapes[character] ?? character).join("");
  };
  if (invocation.xml) {
    return "\n<rdf:Description rdf:about='" + xml(file) + "'\n  xmlns:et='http://ns.exiftool.org/1.0/' et:toolkit='Image::ExifTool " + exiftoolRegistry.source.version + "'\n  xmlns:PNG='http://ns.exiftool.org/PNG/PNG/1.0/'>\n" + tags.map(tag => " <PNG:" + tag.name + ">" + xml(tag.value) + "</PNG:" + tag.name + ">\n").join("") + "</rdf:Description>\n";
  }
  if (invocation.template !== undefined) {
    const parts = parseTemplate(invocation.template);
    const result: string[] = [];
    for (const part of parts) {
      resources.admit("work", tags.length * 32);
      const value = part.literal ?? tags.find(tag => tag.name === part.tag)?.value ?? "-";
      resources.admit("retained", value.length * 8 + 64);
      resources.admit("work", value.length * 4);
      result.push(part.literal !== undefined ? value : text(value));
    }
    return result.join("") + "\n";
  }
  const names = invocation.tags.length ? invocation.tags : tags.map(tag => tag.name);
  resources.admit("work", names.length * tags.length * 32);
  return names.map(name => text(tags.find(tag => tag.name === name)?.value ?? "-")).join("\t") + "\n";
}
