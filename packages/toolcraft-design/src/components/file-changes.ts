import { color } from "./color.js";

export type FileChangeKind = "added" | "modified" | "deleted" | "renamed";
export type FileChangeDisplayMode = "status" | "diff";
export type FileChangeOutputFormat = "terminal" | "markdown";

export interface FileChange {
  path: string;
  kind: FileChangeKind;
  oldPath?: string;
  conflict?: boolean;
  oldContent?: string;
  newContent?: string;
}

export interface RenderFileChangesOptions {
  mode?: FileChangeDisplayMode;
  format?: FileChangeOutputFormat;
}

const STATUS_MARKERS: Record<FileChangeKind, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R"
};

const STATUS_LABELS: Record<FileChangeKind, string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed"
};

function changePath(change: FileChange): string {
  if (change.kind === "renamed" && change.oldPath) {
    return `${change.oldPath} -> ${change.path}`;
  }

  return change.path;
}

function colorStatusMarker(change: FileChange, marker: string): string {
  if (change.conflict) {
    return color.red.bold(marker);
  }

  switch (change.kind) {
    case "added":
      return color.green(marker);
    case "modified":
      return color.yellow(marker);
    case "deleted":
      return color.red(marker);
    case "renamed":
      return color.cyan(marker);
  }
}

function formatSummary(changes: readonly FileChange[]): string {
  const counts = new Map<FileChangeKind, number>();
  let conflicts = 0;

  for (const change of changes) {
    counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
    if (change.conflict) {
      conflicts += 1;
    }
  }

  const details = (Object.keys(STATUS_LABELS) as FileChangeKind[])
    .flatMap((kind) => {
      const count = counts.get(kind) ?? 0;
      return count > 0 ? [`${count} ${STATUS_LABELS[kind]}`] : [];
    });

  if (conflicts > 0) {
    details.push(`${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`);
  }

  return `${changes.length} ${changes.length === 1 ? "change" : "changes"} (${details.join(", ")})`;
}

function renderStatus(changes: readonly FileChange[], format: FileChangeOutputFormat): string {
  const lines = changes.map((change) => {
    const marker = `${STATUS_MARKERS[change.kind]}${change.conflict ? "!" : " "}`;
    const renderedMarker = format === "terminal" ? colorStatusMarker(change, marker) : marker;
    return `${renderedMarker} ${changePath(change)}`;
  });

  const output = [...lines, "", formatSummary(changes)].join("\n");
  return format === "markdown" ? `\`\`\`text\n${output}\n\`\`\`` : output;
}

function diffPath(prefix: "a" | "b", path: string): string {
  return `${prefix}/${path}`;
}

function contentLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function commonPrefixLength(oldLines: readonly string[], newLines: readonly string[]): number {
  const limit = Math.min(oldLines.length, newLines.length);
  let index = 0;
  while (index < limit && oldLines[index] === newLines[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(
  oldLines: readonly string[],
  newLines: readonly string[],
  prefixLength: number
): number {
  const limit = Math.min(oldLines.length, newLines.length) - prefixLength;
  let length = 0;
  while (
    length < limit &&
    oldLines[oldLines.length - length - 1] === newLines[newLines.length - length - 1]
  ) {
    length += 1;
  }
  return length;
}

function hunkRange(startIndex: number, count: number): string {
  const lineNumber = count === 0 ? 0 : startIndex + 1;
  return `${lineNumber},${count}`;
}

function createUnifiedHunk(oldContent: string, newContent: string): string {
  const oldLines = contentLines(oldContent);
  const newLines = contentLines(newContent);
  const prefixLength = commonPrefixLength(oldLines, newLines);
  const suffixLength = commonSuffixLength(oldLines, newLines, prefixLength);
  const context = 3;
  const oldChangeEnd = oldLines.length - suffixLength;
  const newChangeEnd = newLines.length - suffixLength;
  const oldStart = Math.max(0, prefixLength - context);
  const newStart = Math.max(0, prefixLength - context);
  const oldEnd = Math.min(oldLines.length, oldChangeEnd + context);
  const newEnd = Math.min(newLines.length, newChangeEnd + context);
  const oldCount = oldEnd - oldStart;
  const newCount = newEnd - newStart;
  const before = oldLines.slice(oldStart, prefixLength).map((line) => ` ${line}`);
  const removed = oldLines.slice(prefixLength, oldChangeEnd).map((line) => `-${line}`);
  const added = newLines.slice(prefixLength, newChangeEnd).map((line) => `+${line}`);
  const after = oldLines.slice(oldChangeEnd, oldEnd).map((line) => ` ${line}`);

  return [
    `@@ -${hunkRange(oldStart, oldCount)} +${hunkRange(newStart, newCount)} @@`,
    ...before,
    ...removed,
    ...added,
    ...after
  ].join("\n");
}

function createChangePatch(change: FileChange): string {
  const oldPath = change.kind === "added"
    ? "/dev/null"
    : diffPath("a", change.oldPath ?? change.path);
  const newPath = change.kind === "deleted" ? "/dev/null" : diffPath("b", change.path);
  const oldContent = change.kind === "added" ? "" : (change.oldContent ?? "");
  const newContent = change.kind === "deleted" ? "" : (change.newContent ?? "");
  const headers = [`--- ${oldPath}`, `+++ ${newPath}`];

  if (oldContent !== newContent) {
    return [...headers, createUnifiedHunk(oldContent, newContent)].join("\n");
  }

  return headers.join("\n");
}

function colorDiffLine(line: string): string {
  if (line.startsWith("@@")) {
    return color.cyan(line);
  }
  if (line.startsWith("+++") || line.startsWith("---")) {
    return color.bold(line);
  }
  if (line.startsWith("+")) {
    return color.green(line);
  }
  if (line.startsWith("-")) {
    return color.red(line);
  }

  return line;
}

function renderDiff(changes: readonly FileChange[], format: FileChangeOutputFormat): string {
  const output = changes.map(createChangePatch).join("\n\n");
  if (format === "markdown") {
    return `\`\`\`diff\n${output}\n\`\`\``;
  }

  return output.split("\n").map(colorDiffLine).join("\n");
}

export function renderFileChanges(
  changes: readonly FileChange[],
  options: RenderFileChangesOptions = {}
): string {
  if (changes.length === 0) {
    return "No file changes.";
  }

  const mode = options.mode ?? "status";
  const format = options.format ?? "terminal";
  return mode === "diff" ? renderDiff(changes, format) : renderStatus(changes, format);
}
