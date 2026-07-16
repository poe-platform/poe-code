import path from "node:path";
import type { McpSpawnConfig } from "@poe-code/agent-spawn";
import type { FileSystem } from "../utils/file-system.js";
import { ValidationError } from "./errors.js";

export type McpSpawnInput = {
  content: string;
  filePath?: string;
};

export async function resolveMcpSpawnInput(
  input: string | undefined,
  fs: Pick<FileSystem, "readFile">,
  baseDir: string
): Promise<McpSpawnInput | undefined> {
  if (!input) {
    return undefined;
  }

  if (!input.startsWith("@")) {
    return { content: input };
  }

  const rawPath = input.slice(1);
  if (rawPath.length === 0) {
    throw new ValidationError("--mcp-servers @<path> requires a file path after '@'");
  }

  const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(baseDir, rawPath);

  try {
    return { content: await fs.readFile(filePath, "utf8"), filePath };
  } catch (error) {
    throw new ValidationError(
      `--mcp-servers could not read file "${filePath}": ${(error as Error).message}`
    );
  }
}

export function parseMcpSpawnConfig(input?: McpSpawnInput): McpSpawnConfig | undefined {
  if (!input) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    throw new ValidationError(
      "--mcp-servers must be valid JSON in this shape: {name: {command, args?, env?}}"
    );
  }

  if (!isObjectRecord(parsed)) {
    throw new ValidationError(
      "--mcp-servers must be an object in this shape: {name: {command, args?, env?}}"
    );
  }

  const source =
    hasOwnProperty(parsed, "mcpServers") && isObjectRecord(parsed.mcpServers)
      ? parsed.mcpServers
      : parsed;

  const servers = Object.create(null) as McpSpawnConfig;
  for (const [name, value] of Object.entries(source)) {
    if (name.trim().length === 0) {
      throw new ValidationError("--mcp-servers entry name must be a non-empty string");
    }

    if (!isObjectRecord(value)) {
      throw new ValidationError(
        `--mcp-servers entry "${name}" must be an object: {command, args?, env?}`
      );
    }

    const command = hasOwnProperty(value, "command") ? value.command : undefined;
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new ValidationError(
        `--mcp-servers entry "${name}" must include a non-empty string "command"`
      );
    }

    let args: string[] | undefined;
    if (hasOwnProperty(value, "args") && value.args !== undefined) {
      if (!Array.isArray(value.args)) {
        throw new ValidationError(`--mcp-servers entry "${name}".args must be an array of strings`);
      }

      args = [];
      for (const arg of value.args) {
        if (typeof arg !== "string") {
          throw new ValidationError(
            `--mcp-servers entry "${name}".args must be an array of strings`
          );
        }
        args.push(arg);
      }
    }

    let env: Record<string, string> | undefined;
    if (hasOwnProperty(value, "env") && value.env !== undefined) {
      if (!isObjectRecord(value.env)) {
        throw new ValidationError(
          `--mcp-servers entry "${name}".env must be an object of string values`
        );
      }
      env = Object.create(null) as Record<string, string>;
      for (const [envKey, envValue] of Object.entries(value.env)) {
        if (typeof envValue !== "string") {
          throw new ValidationError(
            `--mcp-servers entry "${name}".env must be an object of string values`
          );
        }
        env[envKey] = envValue;
      }
    }

    let timeout: number | undefined;
    if (hasOwnProperty(value, "timeout") && value.timeout !== undefined) {
      if (typeof value.timeout !== "number" || !Number.isFinite(value.timeout) || value.timeout <= 0) {
        throw new ValidationError(
          `--mcp-servers entry "${name}".timeout must be a positive number (seconds)`
        );
      }
      timeout = value.timeout;
    }

    let autoApprove: boolean | undefined;
    if (hasOwnProperty(value, "autoApprove") && value.autoApprove !== undefined) {
      if (typeof value.autoApprove !== "boolean") {
        throw new ValidationError(`--mcp-servers entry "${name}".autoApprove must be a boolean`);
      }
      autoApprove = value.autoApprove;
    }

    servers[name] = {
      command,
      ...(args ? { args } : {}),
      ...(env ? { env } : {}),
      ...(autoApprove !== undefined ? { autoApprove } : {}),
      ...(timeout !== undefined ? { timeout } : {})
    };
  }

  if (Object.keys(servers).length === 0) {
    throw new ValidationError(
      input.filePath
        ? `--mcp-servers file "${input.filePath}" configured no servers: expected at least one entry in this shape: {name: {command, args?, env?}}`
        : "--mcp-servers must configure at least one server in this shape: {name: {command, args?, env?}}"
    );
  }

  return servers;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnProperty(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
