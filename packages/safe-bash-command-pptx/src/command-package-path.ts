import { OfficeError } from "safe-bash-presentation-engine/errors";
function usage(message: string): never { throw new OfficeError("invalid-value", message, "usage"); }
export function scopedPackagePath(manifest: string, path: string): string {
  if (path === "-") return path;
  if (path.includes("\\") || [...path].some((c) => c.charCodeAt(0) < 32))
    usage("Invalid scoped file path.");
  const prefix = path.startsWith("/")
    ? ""
    : manifest === "-"
      ? "/"
      : manifest.slice(0, manifest.lastIndexOf("/") + 1);
  const absolute = (prefix + path).startsWith("/");
  const segments: string[] = [];
  for (const segment of (prefix + path).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) usage("Scoped path escapes its root.");
      segments.pop();
    } else segments.push(segment);
  }
  return (absolute ? "/" : "") + segments.join("/");
}
