import {epubFailure} from "./epub-xml.js";
import type {AdapterContext} from "./types.js";

function* uriComponents(path: string): Generator<string> {
  for (let start = 0;;) {
    const end = path.indexOf("/", start);
    if (end < 0) {yield path.slice(start); return;}
    yield path.slice(start, end); start = end + 1;
  }
}
export function uriPart(part: string): string {
  let encoded = "", first = true;
  for (const component of uriComponents(part)) {
    if (!first) encoded += "/";
    encoded += encodeURIComponent(component); first = false;
  }
  return encoded;
}
export const identity = (part: string, fragment = "") => uriPart(part) + (fragment ? `#${encodeURIComponent(fragment)}` : "");

/** Decode each URI component once, preserving literal archive member identity. */
export function resolve(target: string, base: string, ctx: AdapterContext): {part: string; fragment: string} {
  ctx.charge("references", 1);
  if (target.includes(":") || target.startsWith("/") || target.includes("\\") || target.includes("?")) epubFailure(ctx, base, "Only internal EPUB resource URIs are admitted");
  const split = target.indexOf("#");
  const path = split < 0 ? target : target.slice(0, split);
  let fragment = "";
  const decode = (s: string): string => {
    try {return decodeURIComponent(s);} catch {return epubFailure(ctx, base, "Invalid EPUB URI escape");}
  };
  if (split >= 0) fragment = decode(target.slice(split + 1));
  if (!path) return {part: base, fragment};
  const directoryEnd = base.lastIndexOf("/");
  let part = directoryEnd < 0 ? "" : base.slice(0, directoryEnd);
  for (const raw of uriComponents(path)) {
    ctx.checkpoint();
    const p = decode(raw);
    if (p.includes("/") || p.includes("\\") || p.includes(":")) epubFailure(ctx, base, "Unsafe EPUB URI component");
    for (let index = 0; index < p.length; index++) {
      const unit = p.charCodeAt(index);
      if (unit < 32 || unit === 127) epubFailure(ctx, base, "Unsafe EPUB URI component");
    }
    if (!p || p === ".") continue;
    if (p === "..") {
      if (!part) epubFailure(ctx, base, "EPUB URI traversal");
      const end = part.lastIndexOf("/"); part = end < 0 ? "" : part.slice(0, end);
    } else part += (part ? "/" : "") + p;
  }
  return {part, fragment};
}
