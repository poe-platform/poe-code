import { CurlError } from "./types.js";

/** Keep curl's request spelling separate from WHATWG host validation. */
export function curlRequestTarget(text: string): string {
  const scheme = text.indexOf("://");
  if (scheme < 0) throw new CurlError(3, "Malformed URL; explicit HTTP(S) scheme required");
  let start = scheme + 3;
  while (start < text.length && !"/?#".includes(text[start]!)) {
    if (text[start] === "\\") throw new CurlError(3, "Malformed URL authority");
    start++;
  }
  const fragment = text.indexOf("#", start);
  const target = text.slice(start, fragment < 0 ? undefined : fragment);
  const queryIndex = target.indexOf("?");
  const path = queryIndex < 0 ? target : target.slice(0, queryIndex);
  const query = queryIndex < 0 ? "" : target.slice(queryIndex);
  const segments: string[] = [];
  for (const segment of (path || "/").split("/")) {
    if (segment === "..") { if (segments.length > 1) segments.pop(); }
    else if (segment !== ".") segments.push(segment);
  }
  if (path.endsWith("/.") || path.endsWith("/..")) segments.push("");
  return (segments.join("/") || "/") + query;
}
