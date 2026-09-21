import type fsPromises from "node:fs/promises";
import type { McpFileSpec, McpSpawnConfig } from "./types.js";
export declare function mergeMcpFileContent(
  existing: string | undefined,
  addition: Record<string, unknown>
): string;
export declare function applyMcpFile(
  spec: McpFileSpec,
  servers: McpSpawnConfig,
  cwd: string,
  fs?: Pick<typeof fsPromises, "lstat" | "mkdir" | "readFile" | "writeFile" | "rm">
): Promise<() => Promise<void>>;
