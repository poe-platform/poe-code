import type {Attr} from "./ast-types.js";
import type {AdapterContext} from "./types.js";
import {asciiLower, decodeEntities, htmlSpace} from "./entities.js";

/** Read attributes from an already validated inline HTML span tag. */
export function markdownNativeSpan(tag: string, context: AdapterContext): Attr | "close" | undefined {
  let i = tag[1] === "/" ? 2 : 1;
  if (asciiLower(tag.slice(i, i + 4)) !== "span") return;
  i += 4;
  if (tag[i] !== ">" && tag[i] !== "/" && !htmlSpace(tag[i] ?? "")) return;
  if (tag[1] === "/") return "close";
  const attributes: [string, string[], [string, string][]] = ["", [], []];
  const seen = new Set<string>();
  while (i < tag.length) {
    context.checkpoint();
    while (htmlSpace(tag[i] ?? "")) i++;
    if (tag[i] === ">" || tag[i] === "/") break;
    const start = i;
    while (i < tag.length && !htmlSpace(tag[i]!) && !"=/>".includes(tag[i]!)) i++;
    const name = asciiLower(tag.slice(start, i));
    while (htmlSpace(tag[i] ?? "")) i++;
    let value = "";
    if (tag[i] === "=") {
      i++;
      while (htmlSpace(tag[i] ?? "")) i++;
      const quote = tag[i] === '"' || tag[i] === "'" ? tag[i++] : undefined;
      const start = i;
      while (i < tag.length && (quote ? tag[i] !== quote : !htmlSpace(tag[i]!) && tag[i] !== ">")) i++;
      value = decodeEntities(tag.slice(start, i), true);
      if (quote) i++;
    }
    if (seen.has(name)) continue;
    seen.add(name); context.charge("retainedBytes", (name.length + value.length) * 2 + 32);
    if (name === "id") attributes[0] = value;
    else if (name === "class") {
      let start = 0;
      for (let end = 0; end <= value.length; end++) {
        if (end === value.length || htmlSpace(value[end]!)) {
          if (end > start) attributes[1].push(value.slice(start, end));
          start = end + 1;
        }
      }
    } else attributes[2].push([name, value]);
  }
  return attributes;
}
