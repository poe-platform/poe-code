import path from "node:path";

export function assertValidManagedProcessId(id: string): void {
  if (
    id.length === 0 ||
    id !== id.trim() ||
    id === "." ||
    id === ".." ||
    path.basename(id) !== id ||
    hasControlCharacter(id)
  ) {
    throw new Error(`Invalid managed process id: ${id}`);
  }
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}
