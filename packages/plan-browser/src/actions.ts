import path from "node:path";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { hasOwnErrorCode } from "./error-codes.js";
import type { ActionFs } from "./types.js";

export function resolveEditor(env: Record<string, string | undefined> = process.env): string {
  const editor =
    getOwnEnvValue(env, "VISUAL")?.trim() || getOwnEnvValue(env, "EDITOR")?.trim() || "vi";
  return editor.length > 0 ? editor : "vi";
}

export function editFile(
  absolutePath: string,
  options: {
    env?: Record<string, string | undefined>;
    spawnSync?: typeof nodeSpawnSync;
  } = {}
): void {
  const [editor, ...editorArgs] = parseEditorCommand(resolveEditor(options.env));
  const spawnSync = options.spawnSync ?? nodeSpawnSync;
  const result = spawnSync(editor!, [...editorArgs, absolutePath], { stdio: "inherit" });
  if (result?.error !== undefined) {
    throw result.error;
  }
  if (result?.status !== undefined && result.status !== null && result.status !== 0) {
    throw new Error(`Editor exited with status ${result.status}.`);
  }
}

export function editPlan(
  absolutePath: string,
  options: {
    env?: Record<string, string | undefined>;
    spawnSync?: typeof nodeSpawnSync;
  } = {}
): void {
  editFile(absolutePath, options);
}

async function archiveSelectedPlan(
  entry: Pick<{ absolutePath: string }, "absolutePath">,
  fs: ActionFs
): Promise<string> {
  const archiveDir = path.join(path.dirname(entry.absolutePath), "archive");
  const archivedPath = path.join(archiveDir, path.basename(entry.absolutePath));
  try {
    await fs.readFile(archivedPath, "utf8");
    throw new Error(`Archive destination already exists: ${archivedPath}`);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  await rejectSymbolicLink(archiveDir, fs);
  const createdDirectory = await fs.mkdir(archiveDir, { recursive: true });
  try {
    await rejectSymbolicLink(archiveDir, fs);
    await fs.rename(entry.absolutePath, archivedPath);
  } catch (error) {
    if (createdDirectory !== undefined) {
      await fs.rmdir(archiveDir).catch(() => undefined);
    }
    throw error;
  }
  return archivedPath;
}

async function rejectSymbolicLink(targetPath: string, fs: Pick<ActionFs, "lstat">): Promise<void> {
  try {
    if ((await fs.lstat(targetPath)).isSymbolicLink()) {
      throw new Error(`Refusing to archive plan through symbolic link: ${targetPath}`);
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
}

function getOwnEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return hasOwnErrorCode(error, code);
}

function isCommandWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function parseEditorCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let hasToken = false;

  for (const character of command) {
    if (escaping) {
      current += character;
      escaping = false;
      hasToken = true;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      hasToken = true;
      continue;
    }

    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
        hasToken = true;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      hasToken = true;
      continue;
    }

    if (isCommandWhitespace(character)) {
      if (hasToken) {
        parts.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }

    current += character;
    hasToken = true;
  }

  if (escaping) {
    current += "\\";
  }

  if (hasToken) {
    parts.push(current);
  }

  return parts;
}

export { archiveSelectedPlan as archivePlan };

export async function deletePlan(
  entry: Pick<{ absolutePath: string }, "absolutePath">,
  fs: Pick<ActionFs, "unlink">
): Promise<void> {
  await fs.unlink(entry.absolutePath);
}
