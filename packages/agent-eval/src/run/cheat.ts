import os from "node:os";
import path from "node:path";

import type { CheatReport } from "../types.js";
import type { TraceToolEvent } from "./trace/types.js";

type CheatViolation = CheatReport["violations"][number];

export class CheatFilter {
  private readonly cloneDir: string;
  private readonly allowedPaths: readonly string[];
  private readonly violations: CheatViolation[] = [];
  private readonly observedToolIds = new Set<string>();

  constructor(input: { cloneDir: string; allowedPaths?: readonly string[] }) {
    this.cloneDir = path.resolve(input.cloneDir);
    this.allowedPaths = defaultAllowedPaths()
      .concat(input.allowedPaths ?? [])
      .map((allowedPath) => path.resolve(allowedPath));
  }

  onEvent(event: TraceToolEvent): void {
    if (!isObservedOperation(event.operation) || this.alreadyObserved(event)) {
      return;
    }

    for (const eventPath of readToolPaths(event)) {
      const resolvedPath = resolveAgainstClone(this.cloneDir, eventPath);
      if (isUnderAny(resolvedPath, [this.cloneDir, ...this.allowedPaths])) {
        continue;
      }

      this.violations.push({
        path: resolvedPath,
        toolCall: event.name,
        reason: "outside-clone"
      });
    }
  }

  private alreadyObserved(event: TraceToolEvent): boolean {
    if (event.id === undefined) {
      return event.phase !== "start";
    }

    if (this.observedToolIds.has(event.id)) {
      return true;
    }

    this.observedToolIds.add(event.id);
    return false;
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

function isObservedOperation(operation: TraceToolEvent["operation"]): boolean {
  return operation === "read" || operation === "search" || operation === "exec";
}

function readToolPaths(event: TraceToolEvent): readonly string[] {
  if (event.paths.length > 0) {
    return event.paths;
  }

  const inputPath = readRawInputPath(event.rawArguments);
  if (inputPath !== undefined) {
    return [inputPath];
  }

  if (event.operation === "exec") {
    const executable = readFirstToken(event.name);
    return executable === undefined ? [] : [executable];
  }

  return [event.name];
}

function readRawInputPath(rawArguments: unknown): string | undefined {
  if (!isRecord(rawArguments)) {
    return undefined;
  }

  const pathValue =
    readString(rawArguments.path) ??
    readString(rawArguments.filePath) ??
    readString(rawArguments.file_path);
  if (pathValue !== undefined) {
    return pathValue;
  }

  const pattern = readString(rawArguments.pattern);
  if (pattern !== undefined) {
    return pattern;
  }

  const command = readString(rawArguments.command);
  return command === undefined ? undefined : readFirstToken(command);
}

function readFirstToken(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
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
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
