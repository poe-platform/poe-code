import path from "node:path";

export function assertValidManagedProcessId(id: string): void {
  if (id.length === 0 || id === "." || id === ".." || path.basename(id) !== id) {
    throw new Error(`Invalid managed process id: ${id}`);
  }
}
