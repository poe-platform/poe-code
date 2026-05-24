import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  readSync,
  symlinkSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { getAgentConfig, resolveHookPath, type AgentHookConfig } from "./configs.js";

export interface SymlinkResult {
  /** Where the symlink was placed. */
  symlinkPath: string;
  /** What the symlink points to. */
  targetPath: string;
  replaced: "none" | "stale-symlink" | "generated-file";
}

type SymlinkScope = "project" | "user";

interface HookHandler {
  statusMessage?: unknown;
}

interface HookGroup {
  hooks?: unknown;
}

interface HooksFile {
  hooks?: unknown;
}

function requireAgentConfig(agentId: string): AgentHookConfig {
  const config = getAgentConfig(agentId);
  if (!config) {
    throw new Error(`No hook configuration found for agent "${agentId}"`);
  }

  return config;
}

function resolveScopedPath(
  config: AgentHookConfig,
  agentId: string,
  cwd: string,
  homeDir: string,
  scope: SymlinkScope
): string {
  const targetPath = resolveHookPath(
    config,
    scope === "project" ? "local" : "global",
    cwd,
    homeDir
  );
  if (!targetPath) {
    throw new Error(`Agent "${agentId}" has no ${scope} hook path`);
  }

  return targetPath;
}

function readFirstKilobyte(filePath: string): string {
  const descriptor = openSync(filePath, "r");
  const buffer = Buffer.alloc(1024);

  try {
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, length);
  } finally {
    closeSync(descriptor);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFullyGeneratedFile(filePath: string): boolean {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFirstKilobyte(filePath));
  } catch {
    return false;
  }

  if (!isRecord(parsed)) {
    return false;
  }

  if (Object.keys(parsed).some((key) => key !== "hooks")) {
    return false;
  }

  const hooks = (parsed as HooksFile).hooks;
  if (!isRecord(hooks)) {
    return false;
  }

  let handlerFound = false;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) {
      return false;
    }

    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray((group as HookGroup).hooks)) {
        return false;
      }

      for (const handler of (group as HookGroup).hooks as unknown[]) {
        if (!isRecord(handler)) {
          return false;
        }

        handlerFound = true;
        const statusMessage = (handler as HookHandler).statusMessage;
        if (typeof statusMessage !== "string" || !statusMessage.startsWith("[generated:")) {
          return false;
        }
      }
    }
  }

  return handlerFound;
}

export function symlinkHooks(
  sourceAgentId: string,
  targetAgentId: string,
  cwd: string,
  homeDir: string,
  scope: SymlinkScope
): SymlinkResult {
  const source = requireAgentConfig(sourceAgentId);
  const target = requireAgentConfig(targetAgentId);

  if (source.format !== target.format) {
    throw new Error(
      `Cannot symlink hook formats "${source.format}" and "${target.format}"; use transformation instead`
    );
  }

  const targetPath = resolveScopedPath(source, sourceAgentId, cwd, homeDir, scope);
  const symlinkPath = resolveScopedPath(target, targetAgentId, cwd, homeDir, scope);
  let replaced: SymlinkResult["replaced"] = "none";

  try {
    const existing = lstatSync(symlinkPath);
    if (existing.isSymbolicLink()) {
      if (readlinkSync(symlinkPath) === targetPath) {
        return { symlinkPath, targetPath, replaced };
      }

      unlinkSync(symlinkPath);
      replaced = "stale-symlink";
    } else if (existing.isFile() && isFullyGeneratedFile(symlinkPath)) {
      unlinkSync(symlinkPath);
      replaced = "generated-file";
    } else {
      throw new Error(`Refuse to replace user-authored hook file at ${symlinkPath}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  mkdirSync(path.dirname(symlinkPath), { recursive: true });
  symlinkSync(targetPath, symlinkPath);

  return { symlinkPath, targetPath, replaced };
}
