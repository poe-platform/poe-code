import path from "node:path";
import { hashFiles } from "./hash.js";
import type { AgentStashFile, AgentStashItem, AgentStashManifest } from "./types.js";

export const MANIFEST_FILENAME = "agent-stash.json";

export function validateBundlePath(bundlePath: unknown): asserts bundlePath is string {
  if (typeof bundlePath !== "string") {
    throw new Error(`Bundle path must be a string: ${String(bundlePath)}`);
  }
  if (bundlePath.length === 0) {
    throw new Error("Bundle path must not be empty.");
  }
  if (path.isAbsolute(bundlePath) || bundlePath.startsWith("/")) {
    throw new Error(`Bundle path must be relative: ${bundlePath}`);
  }
  if (bundlePath.includes("\\")) {
    throw new Error(`Bundle path must use forward slashes: ${bundlePath}`);
  }
  const segments = bundlePath.split("/");
  if (segments.includes("") || segments.includes(".") || segments.includes("..")) {
    throw new Error(`Bundle path must not contain traversal: ${bundlePath}`);
  }
}

export function stableItemId(input: {
  scope: string;
  kind: string;
  agentId: string;
  name: string;
}): string {
  return `${input.scope}:${input.kind}:${input.agentId}:${input.name}`;
}

export function serializeManifest(manifest: AgentStashManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseManifest(content: string): AgentStashManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error("Malformed agent-stash manifest.");
  }
  validateManifest(parsed);
  return parsed;
}

export function validateManifest(manifest: unknown): asserts manifest is AgentStashManifest {
  if (!isRecord(manifest)) {
    throw new Error("Manifest must be an object.");
  }
  const candidate = manifest as unknown as AgentStashManifest;
  if (candidate.schemaVersion !== 1) {
    throw new Error("Unsupported agent-stash manifest schema version.");
  }
  validateManifestProfile(candidate.profile);
  validateTimestamp("createdAt", candidate.createdAt);
  validateTimestamp("updatedAt", candidate.updatedAt);
  if (!Array.isArray(candidate.items)) {
    throw new Error("Manifest items must be an array.");
  }
  const ids = new Set<string>();
  for (const item of candidate.items) {
    validateManifestItem(item);
    if (ids.has(item.id)) {
      throw new Error(`Duplicate manifest item id: ${item.id}`);
    }
    ids.add(item.id);
  }
}

export function validateManifestItem(item: unknown): asserts item is AgentStashItem {
  if (!isRecord(item)) {
    throw new Error("Manifest item must be an object.");
  }
  const candidate = item as unknown as AgentStashItem;
  if (candidate.kind !== "skill" && candidate.kind !== "hook") {
    throw new Error(`Unsupported manifest item kind: ${String(candidate.kind)}`);
  }
  if (candidate.scope !== "project" && candidate.scope !== "global") {
    throw new Error(`Unsupported manifest item scope: ${String(candidate.scope)}`);
  }
  validateManifestSegment("agent id", candidate.agentId);
  validateManifestSegment("item name", candidate.name);
  validateTimestamp("item updatedAt", candidate.updatedAt);
  validateBundlePath(candidate.path);
  const expectedId = stableItemId(candidate);
  if (candidate.id !== expectedId) {
    throw new Error(`Manifest item id mismatch for ${candidate.id}`);
  }
  if (candidate.path !== canonicalItemPath(candidate)) {
    throw new Error(`Manifest item path mismatch for ${candidate.id}`);
  }
  if (!Array.isArray(candidate.files)) {
    throw new Error(`Manifest item files must be an array: ${candidate.id}`);
  }
  if (candidate.kind === "skill" && candidate.files.length === 0) {
    throw new Error(`Skill manifest item must contain at least one file under ${candidate.path}`);
  }
  const filePaths = new Set<string>();
  for (const file of candidate.files) {
    validateManifestFile(file);
    if (filePaths.has(file.path)) {
      throw new Error(`Duplicate manifest file path: ${file.path}`);
    }
    filePaths.add(file.path);
    if (candidate.kind === "skill" && file.path === candidate.path) {
      throw new Error(`Skill manifest file must be under skill directory: ${file.path}`);
    }
    if (!isFileInItemPath(candidate.path, file.path)) {
      throw new Error(`Manifest file must be under item path: ${file.path}`);
    }
  }
  if (candidate.kind === "hook" && (candidate.files.length !== 1 || candidate.files[0]?.path !== candidate.path)) {
    throw new Error(`Hook manifest item must contain exactly ${candidate.path}`);
  }
  if (candidate.contentHash !== hashFiles(candidate.files)) {
    throw new Error(`Manifest item content hash mismatch for ${candidate.id}`);
  }
}

function validateManifestSegment(label: string, value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes(":")
  ) {
    throw new Error(`Invalid manifest ${label}: ${String(value)}`);
  }
}

function validateManifestProfile(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !isAsciiAlphaNumeric(value[0]) ||
    [...value].some((character) => !isProfileCharacter(character))
  ) {
    throw new Error(`Invalid manifest profile: ${String(value)}`);
  }
}

function isProfileCharacter(character: string): boolean {
  return isAsciiAlphaNumeric(character) || character === "." || character === "_" || character === "-";
}

function isAsciiAlphaNumeric(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }
  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function validateTimestamp(label: string, value: unknown): void {
  if (typeof value !== "string") {
    throw new Error(`Invalid manifest ${label}: ${String(value)}`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`Invalid manifest ${label}: ${value}`);
  }
}

export function canonicalItemPath(item: AgentStashItem): string {
  if (item.kind === "skill") {
    return `skills/${item.scope}/${item.agentId}/${item.name}`;
  }
  return `hooks/${item.scope}/${item.agentId}/${item.name}.json`;
}

function isFileInItemPath(itemPath: string, filePath: string): boolean {
  if (filePath === itemPath) {
    return true;
  }
  return filePath.startsWith(`${itemPath}/`);
}

function validateManifestFile(file: unknown): asserts file is AgentStashFile {
  if (!isRecord(file)) {
    throw new Error("Manifest file must be an object.");
  }
  const candidate = file as unknown as AgentStashFile;
  validateBundlePath(candidate.path);
  if (!Number.isSafeInteger(candidate.size) || candidate.size < 0) {
    throw new Error(`Invalid manifest file size for ${candidate.path}`);
  }
  if (typeof candidate.sha256 !== "string" || candidate.sha256.length !== 64 || !isLowercaseHex(candidate.sha256)) {
    throw new Error(`Invalid manifest file hash for ${candidate.path}`);
  }
}

function isLowercaseHex(value: string): boolean {
  return [...value].every((character) => {
    const code = character.charCodeAt(0);
    return (code >= 48 && code <= 57) || (code >= 97 && code <= 102);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createEmptyManifest(now: Date, profile?: string): AgentStashManifest {
  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    profile,
    createdAt: timestamp,
    updatedAt: timestamp,
    items: []
  };
}
