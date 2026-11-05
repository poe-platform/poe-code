import type {AdapterContext} from "./types.js";
import {fencedDivAttributes} from "./commonmark-syntax.js";

export function headingAttributes(text: string, context: AdapterContext) {
  text = text.trimEnd();
  if (!text.endsWith("}")) return;
  for (let start = 0; start < text.length; start++) {
    context.checkpoint();
    if (text[start] === "\\") {start++; continue;}
    if (text[start] !== "{") continue;
    const attributes = fencedDivAttributes(text.slice(start), context);
    if (attributes) return {attributes, end: text.slice(0, start).trimEnd().length};
  }
}

export function headingIdentifier(inlines: readonly import("./ast-types.js").Inline[], context: AdapterContext): string {
  let text = "";
  const append = (nodes: typeof inlines) => {
    for (const node of nodes) {
      context.checkpoint();
      switch (node.t) {
        case "Str": text += node.c; break;
        case "Code": case "Math": text += node.c[1]; break;
        case "Space": case "SoftBreak": case "LineBreak": text += " "; break;
        case "RawInline": case "Note": break;
        case "Link": case "Image": case "Span": case "Quoted": case "Cite": append(node.c[1]); break;
        default: append(node.c);
      }
    }
  };
  append(inlines);
  context.charge("retainedBytes", text.length * 4);
  let id = "", started = false;
  for (const char of text.toLowerCase()) {
    context.checkpoint();
    if (!started) {if (!/\p{L}/u.test(char)) continue; started = true;}
    if (/^[\p{L}\p{N}_.-]$/u.test(char)) id += char;
    else if (char === " " || char === "\n") id += "-";
  }
  return id || "section";
}
