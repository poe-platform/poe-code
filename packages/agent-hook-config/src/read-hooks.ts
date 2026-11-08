import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";

export interface SourceHookEntry {
  event: string;
  matcher?: string;
  handler: {
    type: string;
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
    server?: string;
    tool?: string;
    input?: Record<string, unknown>;
    prompt?: string;
    model?: string;
    timeout?: number;
    statusMessage?: string;
    if?: string;
    once?: boolean;
    shell?: string;
  };
}

export interface HookReadResult {
  entries: SourceHookEntry[];
  /** Paths actually read, in order. Empty when no source files existed. */
  readPaths: string[];
}

interface ClaudeMatcherGroup {
  matcher?: string;
  hooks: SourceHookEntry["handler"][];
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeMatcherGroup[]>;
}

function isHookHandler(value: unknown): value is SourceHookEntry["handler"] {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSettingsFile(filePath: string): ClaudeSettings | undefined {
  let content: string;

  try {
    if (lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`Hook settings path must not be a symbolic link: ${filePath}`);
    }
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }

  try {
    return JSON.parse(content) as ClaudeSettings;
  } catch (error) {
    throw new Error(`Malformed JSON in ${filePath}`, { cause: error });
  }
}

export function readClaudeHooks(
  cwd: string,
  homeDir: string,
  opts?: { scope?: "project" | "user" | "merged" }
): HookReadResult {
  const projectPath = path.resolve(cwd, ".claude/settings.json");
  const userPath = path.resolve(homeDir, ".claude/settings.json");
  const scope = opts?.scope ?? "merged";
  const sourcePaths =
    scope === "project" ? [projectPath] : scope === "user" ? [userPath] : [userPath, projectPath];
  const result: HookReadResult = { entries: [], readPaths: [] };

  for (const sourcePath of sourcePaths) {
    const settings = readSettingsFile(sourcePath);
    if (settings === undefined) {
      continue;
    }

    result.readPaths.push(sourcePath);

    for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
      if (!Array.isArray(groups)) {
        throw new Error(`Malformed hooks in ${sourcePath}`);
      }
      for (const group of groups) {
        if (!group || !Array.isArray(group.hooks)) {
          throw new Error(`Malformed hooks in ${sourcePath}`);
        }
        for (const handler of group.hooks) {
          if (!isHookHandler(handler)) {
            throw new Error(`Malformed hooks in ${sourcePath}`);
          }
          result.entries.push({ event, matcher: group.matcher, handler });
        }
      }
    }
  }

  return result;
}
