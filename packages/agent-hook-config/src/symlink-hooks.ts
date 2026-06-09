import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { getAgentConfig, resolveHookPath, type AgentHookConfig } from "./configs.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { assertNoSymbolicLink } from "./path-safety.js";

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
        if (
          typeof statusMessage !== "string" ||
          !statusMessage.startsWith("[generated:poe-code:")
        ) {
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

  const targetPath = resolveScopedPath(
    source,
    sourceAgentId,
    cwd,
    homeDir,
    sourceAgentId === targetAgentId && scope === "project" ? "user" : scope
  );
  const symlinkPath = resolveScopedPath(target, targetAgentId, cwd, homeDir, scope);
  const symlinkParent = path.dirname(symlinkPath);
  let replaced: SymlinkResult["replaced"] = "none";
  let replacedContents: string | undefined;

  assertNoSymbolicLink(symlinkParent);

  try {
    const existing = lstatSync(symlinkPath);
    if (existing.isSymbolicLink()) {
      if (readlinkSync(symlinkPath) === targetPath) {
        return { symlinkPath, targetPath, replaced };
      }

      unlinkSync(symlinkPath);
      replaced = "stale-symlink";
    } else if (existing.isFile() && isFullyGeneratedFile(symlinkPath)) {
      replacedContents = readFileSync(symlinkPath, "utf8");
      unlinkSync(symlinkPath);
      replaced = "generated-file";
    } else {
      throw new Error(`Refuse to replace user-authored hook file at ${symlinkPath}`);
    }
  } catch (error) {
    if (!hasOwnErrorCode(error, "ENOENT")) {
      throw error;
    }
  }

  try {
    mkdirSync(symlinkParent, { recursive: true });
    assertNoSymbolicLink(symlinkParent);
    symlinkSync(targetPath, symlinkPath);
  } catch (error) {
    restoreGeneratedFile(symlinkParent, symlinkPath, replacedContents, error);
    throw error;
  }

  return { symlinkPath, targetPath, replaced };
}

function restoreGeneratedFile(
  symlinkParent: string,
  symlinkPath: string,
  contents: string | undefined,
  originalError: unknown
): void {
  if (contents === undefined) {
    return;
  }

  try {
    assertNoSymbolicLink(symlinkParent);
    writeFileSync(symlinkPath, contents, { encoding: "utf8", flag: "wx" });
  } catch (restoreError) {
    throw new AggregateError(
      [originalError, restoreError],
      [
        `Hook symlink replacement failed: ${formatUnknownError(originalError)}`,
        `Generated hook file restore failed: ${formatUnknownError(restoreError)}`
      ].join(" ")
    );
  }
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}
