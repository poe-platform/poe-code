import crypto from "node:crypto";
import path from "node:path";

const maxWorkspaceKeyLength = 255;
const workspaceKeyHashLength = 16;

export function sanitizeWorkspaceKey(qualifiedId: string): string {
  if (qualifiedId.length === 0) {
    throw new Error("qualifiedId must not be empty");
  }

  assertWorkspaceKeyInputIsNotAPath(qualifiedId);

  let sanitized = "";
  let changed = false;

  for (const character of qualifiedId) {
    if (isWorkspaceKeyCharacter(character)) {
      sanitized += character;
    } else {
      sanitized += "_";
      changed = true;
    }
  }

  if (changed || sanitized.length > maxWorkspaceKeyLength) {
    return appendStableHash(sanitized, qualifiedId);
  }

  return sanitized;
}

export function appendWorkspaceKeyHash(sanitized: string, qualifiedId: string): string {
  return appendStableHash(sanitized, qualifiedId);
}

function assertWorkspaceKeyInputIsNotAPath(qualifiedId: string): void {
  if (path.isAbsolute(qualifiedId) || path.win32.isAbsolute(qualifiedId)) {
    throw new Error("workspace id must not be an absolute path");
  }

  if (qualifiedId.includes("\0")) {
    throw new Error("workspace id must not contain NUL bytes");
  }

  for (const character of qualifiedId) {
    const code = character.charCodeAt(0);

    if (code < 32 || code === 127) {
      throw new Error("workspace id must not contain control characters");
    }
  }

  if (qualifiedId.includes("/") || qualifiedId.includes("\\")) {
    throw new Error("workspace id must not be an absolute path or contain path separators");
  }

  if (qualifiedId.includes("..")) {
    throw new Error("workspace id must not contain parent path segments");
  }
}

function appendStableHash(sanitized: string, qualifiedId: string): string {
  const hash = crypto.createHash("sha256").update(qualifiedId).digest("hex").slice(0, 16);
  const maxBaseLength = maxWorkspaceKeyLength - workspaceKeyHashLength - 1;
  const base = sanitized.slice(0, maxBaseLength) || "_";

  return `${base}-${hash}`;
}

function isWorkspaceKeyCharacter(character: string): boolean {
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
