import { resourceUri } from "../resource-uri.js";

/** GFile-style display basename; never used to grant resource access. */
export function resourceBasename(name: string | undefined, cwd: string): string {
  if (name === undefined) return "(unspecified)";
  const uri = resourceUri(name, cwd);
  try {
    const url = new URL(uri.split("\\").join("%5C"));
    const path = decodeURIComponent(url.pathname);
    return path.slice(path.lastIndexOf("/") + 1) || ".";
  } catch { return name.slice(name.lastIndexOf("/") + 1); }
}
