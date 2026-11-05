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
