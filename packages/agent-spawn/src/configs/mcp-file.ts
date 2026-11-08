import fsPromises from "node:fs/promises";
import path from "node:path";
import type { McpFileSpec, McpSpawnConfig } from "../types.js";

type McpFileSystem = Pick<
  typeof fsPromises,
  "lstat" | "mkdir" | "readFile" | "writeFile" | "rm"
>;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(
  existing: Record<string, unknown>,
  addition: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(addition)) {
    const current = merged[key];
    merged[key] = isObject(current) && isObject(value) ? deepMerge(current, value) : value;
  }
  return merged;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

function assertPathInsideCwd(cwd: string, target: string): void {
  const resolvedCwd = path.resolve(cwd);
  const relative = path.relative(resolvedCwd, target);
  if (relative === "") {
    return;
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("MCP config path must stay inside the workspace.");
  }
}

async function assertNoSymlinkInPath(
  cwd: string,
  target: string,
  fs: McpFileSystem
): Promise<void> {
  assertPathInsideCwd(cwd, target);
  const resolvedCwd = path.resolve(cwd);
  const relative = path.relative(resolvedCwd, target);
  const segments = relative.split(path.sep).filter((segment) => segment.length > 0);
  let current = resolvedCwd;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error("MCP config path must not contain symbolic links.");
      }
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
  }
}

export function mergeMcpFileContent(
  existing: string | undefined,
  addition: Record<string, unknown>
): string {
  let parsed: unknown = {};
  if (existing !== undefined && existing.trim().length > 0) {
    try {
      parsed = JSON.parse(existing);
    } catch (error) {
      throw new Error("Unable to parse existing MCP config JSON.", { cause: error });
    }
  }
  if (!isObject(parsed)) {
    throw new Error("Existing MCP config JSON must contain an object.");
  }
  return `${JSON.stringify(deepMerge(parsed, addition), null, 2)}\n`;
}

export async function applyMcpFile(
  spec: McpFileSpec,
  servers: McpSpawnConfig,
  cwd: string,
  fs: McpFileSystem = fsPromises
): Promise<() => Promise<void>> {
  const target = path.resolve(cwd, spec.relativePath);
  await assertNoSymlinkInPath(cwd, target, fs);
  let existing: string | undefined;
  try {
    existing = await fs.readFile(target, "utf8");
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await assertNoSymlinkInPath(cwd, target, fs);
  await fs.writeFile(target, mergeMcpFileContent(existing, spec.content(servers)), "utf8");
  return async () => {
    await assertNoSymlinkInPath(cwd, target, fs);
    if (existing === undefined) {
      await fs.rm(target, { force: true });
      return;
    }
    await fs.writeFile(target, existing, "utf8");
  };
}
