import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";

import { appendWorkspaceKeyHash, sanitizeWorkspaceKey } from "../runtime/sanitize.js";

export interface EnsureWorkspaceResult {
  path: string;
  createdNow: boolean;
}

export async function ensureWorkspace(
  root: string,
  qualifiedId: string
): Promise<EnsureWorkspaceResult> {
  const workspacePath = resolveWorkspacePath(root, qualifiedId);
  await ensureWorkspaceRoot(root);

  const existing = await statIfExists(workspacePath);

  if (existing !== undefined && !existing.isDirectory()) {
    throw new Error(`workspace path exists and is not a directory: ${workspacePath}`);
  }

  await fs.mkdir(workspacePath, { recursive: true });

  return {
    path: workspacePath,
    createdNow: existing === undefined
  };
}

export async function removeWorkspace(root: string, qualifiedId: string): Promise<void> {
  const workspacePath = resolveWorkspacePath(root, qualifiedId);
  await fs.rm(workspacePath, { recursive: true, force: true });
}

export async function startupTerminalCleanup(
  root: string,
  terminalQualifiedIds: string[]
): Promise<{ removed: number }> {
  const rootStat = await statIfExists(root);

  if (rootStat === undefined) {
    return { removed: 0 };
  }

  if (!rootStat.isDirectory()) {
    throw new Error(`workspace root exists and is not a directory: ${root}`);
  }

  const terminalKeys = new Set(
    terminalQualifiedIds.map((qualifiedId) => resolveWorkspaceKey(root, qualifiedId))
  );
  let removed = 0;

  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && terminalKeys.has(entry.name)) {
      await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
      removed += 1;
    }
  }

  return { removed };
}

function resolveWorkspacePath(root: string, qualifiedId: string): string {
  const key = resolveWorkspaceKey(root, qualifiedId);
  const workspacePath = path.join(root, key);
  assertContained(root, workspacePath);
  return workspacePath;
}

function resolveWorkspaceKey(root: string, qualifiedId: string): string {
  assertQualifiedIdIsNotAPathEscape(qualifiedId);
  const key = qualifiedId.includes("/")
    ? appendWorkspaceKeyHash(
        qualifiedId
          .split("/")
          .map((segment) => sanitizeWorkspaceKey(segment))
          .join("_"),
        qualifiedId
      )
    : sanitizeWorkspaceKey(qualifiedId);

  if (!isSafeWorkspaceKey(key)) {
    throw new Error(`workspace key contains unsupported characters: ${key}`);
  }

  assertContained(root, path.join(root, key));
  return key;
}

async function ensureWorkspaceRoot(root: string): Promise<void> {
  const existing = await statIfExists(root);

  if (existing !== undefined && !existing.isDirectory()) {
    throw new Error(`workspace root exists and is not a directory: ${root}`);
  }

  if (existing === undefined) {
    await fs.mkdir(root, { recursive: true });
  }
}

function assertQualifiedIdIsNotAPathEscape(qualifiedId: string): void {
  if (path.isAbsolute(qualifiedId) || path.win32.isAbsolute(qualifiedId)) {
    throw new Error("workspace id must not be an absolute path");
  }

  if (pathSegments(qualifiedId).includes("..")) {
    throw new Error("workspace id must not contain parent path segments");
  }
}

function assertContained(root: string, workspacePath: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedWorkspacePath = path.resolve(workspacePath);

  if (!resolvedWorkspacePath.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`workspace path escapes root: ${workspacePath}`);
  }
}

function pathSegments(value: string): string[] {
  return value.split("/").flatMap((segment) => segment.split("\\"));
}

function isSafeWorkspaceKey(value: string): boolean {
  for (const character of value) {
    if (!isSafeWorkspaceKeyCharacter(character)) {
      return false;
    }
  }

  return value.length > 0;
}

function isSafeWorkspaceKeyCharacter(character: string): boolean {
  const code = character.charCodeAt(0);

  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    character === "." ||
    character === "_" ||
    character === "-"
  );
}

async function statIfExists(filePath: string): Promise<Stats | undefined> {
  try {
    return await fs.stat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
