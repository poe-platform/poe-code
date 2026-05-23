const SAFE_FILESYSTEM_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function filesystemSafeNamePart(value: string, field: string): string {
  if (
    !value ||
    value.trim() !== value ||
    value.normalize("NFKC") !== value ||
    value.startsWith(".") ||
    value === "." ||
    value === ".." ||
    !SAFE_FILESYSTEM_NAME_RE.test(value)
  ) {
    throw new Error(`${field} must be a safe filesystem name.`);
  }
  return value.toLowerCase().replaceAll("_", "%5f");
}
