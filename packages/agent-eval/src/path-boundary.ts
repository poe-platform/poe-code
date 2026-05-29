import path from "node:path";

export function resolveContainedPath(
  rootDir: string,
  configuredPath: string,
  field: string
): string {
  const absoluteRootDir = path.resolve(rootDir);
  const resolved = path.resolve(absoluteRootDir, configuredPath);
  const relative = path.relative(absoluteRootDir, resolved);

  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`${field} must stay within the ${fieldRootDescription(field)}.`);
  }

  return resolved;
}

function fieldRootDescription(field: string): string {
  return field === "oracle.path" ? "eval directory" : "clone directory";
}
