import fsPromises from "node:fs/promises";
import path from "node:path";
import type { McpFileSpec, McpSpawnConfig } from "../types.js";

type McpFileSystem = Pick<typeof fsPromises, "mkdir" | "readFile" | "writeFile" | "rm">;

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
  let existing: string | undefined;
  try {
    existing = await fs.readFile(target, "utf8");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, mergeMcpFileContent(existing, spec.content(servers)), "utf8");
  return async () => {
    if (existing === undefined) {
      await fs.rm(target, { force: true });
      return;
    }
    await fs.writeFile(target, existing, "utf8");
  };
}
