import os from "node:os";
import path from "node:path";

import type { CheatReport, SpawnEvent } from "../types.js";

type CheatViolation = CheatReport["violations"][number];
type ToolPathEvent = {
  kind: "read" | "exec" | "glob";
  title: string;
  path?: string;
  rawInput?: unknown;
};

const RAW_INPUT_PATH_KEYS = ["path", "filePath", "file_path", "pattern", "command"] as const;

export class CheatFilter {
  private readonly cloneDir: string;
  private readonly allowedPaths: readonly string[];
  private readonly violations: CheatViolation[] = [];

  constructor(input: { cloneDir: string; allowedPaths?: readonly string[] }) {
    this.cloneDir = path.resolve(input.cloneDir);
    this.allowedPaths = defaultAllowedPaths()
      .concat(input.allowedPaths ?? [])
      .map((allowedPath) => path.resolve(allowedPath));
  }

  onEvent(event: SpawnEvent): void {
    const toolEvent = readToolPathEvent(event);
    if (toolEvent === undefined) {
      return;
    }

    const eventPath = readToolPath(toolEvent);
    if (eventPath === undefined) {
      return;
    }

    const resolvedPath = resolveAgainstClone(this.cloneDir, eventPath);
    if (isUnderAny(resolvedPath, [this.cloneDir, ...this.allowedPaths])) {
      return;
    }

    this.violations.push({
      path: resolvedPath,
      toolCall: toolEvent.title,
      reason: "outside-clone"
    });
  }

  report(): CheatReport {
    return {
      cheated: this.violations.length > 0,
      violations: this.violations.slice()
    };
  }
}

function defaultAllowedPaths(): string[] {
  const allowedPaths = [
    os.tmpdir(),
    path.join(os.homedir(), ".cache"),
    "/usr/bin",
    "/usr/local/bin",
    "/bin"
  ];

  if (process.platform === "darwin") {
    allowedPaths.push("/opt/homebrew/bin");
  }

  return allowedPaths;
}

function readToolPathEvent(event: SpawnEvent): ToolPathEvent | undefined {
  if (isRecord(event) && event.sessionUpdate === "tool_call") {
    const kind = normalizeToolKind(readString(event.kind));
    if (kind === undefined) {
      return undefined;
    }

    const fallbackTitle = readString(event.toolCallId) ?? kind;
    return {
      kind,
      title: readString(event.title) ?? fallbackTitle,
      path: readLocationPath(event),
      rawInput: event.rawInput ?? event.input
    };
  }

  if (isRecord(event) && event.event === "tool_start") {
    const kind = normalizeToolKind(readString(event.kind));
    if (kind === undefined) {
      return undefined;
    }

    const fallbackTitle = readString(event.id) ?? kind;
    return {
      kind,
      title: readString(event.title) ?? fallbackTitle,
      path: readString(event.path),
      rawInput: event.rawInput ?? event.input
    };
  }

  return undefined;
}

function normalizeToolKind(kind: string | undefined): ToolPathEvent["kind"] | undefined {
  if (kind === "execute" || kind === "exec") {
    return "exec";
  }
  if (kind === "read" || kind === "glob") {
    return kind;
  }
  if (kind === "search") {
    return "glob";
  }
  return undefined;
}

function readToolPath(event: ToolPathEvent): string | undefined {
  if (event.path !== undefined) {
    return event.path;
  }

  const inputPath = readRawInputPath(event.rawInput);
  if (inputPath !== undefined) {
    return inputPath;
  }

  if (event.kind === "exec") {
    return readFirstToken(event.title);
  }

  return event.title;
}

function readRawInputPath(rawInput: unknown): string | undefined {
  if (!isRecord(rawInput)) {
    return undefined;
  }

  for (const key of RAW_INPUT_PATH_KEYS) {
    const value = readString(rawInput[key]);
    if (value === undefined) {
      continue;
    }
    return key === "command" ? readFirstToken(value) : value;
  }

  return undefined;
}

function readLocationPath(event: Record<string, unknown>): string | undefined {
  const locations = event.locations;
  if (!Array.isArray(locations)) {
    return undefined;
  }

  for (const location of locations) {
    if (!isRecord(location)) {
      continue;
    }

    const locationPath = readString(location.path);
    if (locationPath !== undefined) {
      return locationPath;
    }
  }

  return undefined;
}

function readFirstToken(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const quote = trimmed[0];
  if (quote === "\"" || quote === "'") {
    const end = trimmed.indexOf(quote, 1);
    return end === -1 ? trimmed.slice(1) : trimmed.slice(1, end);
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    if (isWhitespace(trimmed[index])) {
      return trimmed.slice(0, index);
    }
  }

  return trimmed;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function resolveAgainstClone(cloneDir: string, targetPath: string): string {
  if (path.isAbsolute(targetPath)) {
    return path.resolve(targetPath);
  }
  return path.resolve(cloneDir, targetPath);
}

function isUnderAny(targetPath: string, roots: readonly string[]): boolean {
  return roots.some((root) => isUnderPath(targetPath, root));
}

function isUnderPath(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
