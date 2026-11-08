import type { Task } from "@poe-code/task-list";
import { parseDocument } from "yaml";

export function resolveWorkflowKind(task: Task): string {
  if (task.sourcePath === undefined) {
    return "pipeline";
  }

  const frontmatterKind = readFrontmatterKind(task.description);
  if (frontmatterKind !== undefined) {
    return frontmatterKind;
  }

  return readKind(task.metadata.kind) ?? "pipeline";
}

function readFrontmatterKind(description: string): string | undefined {
  const frontmatter = leadingFrontmatter(description);
  if (frontmatter === undefined) {
    return undefined;
  }

  const document = parseDocument(frontmatter);
  if (document.errors.length > 0) {
    return undefined;
  }

  const parsed = document.toJS();
  if (!isRecord(parsed)) {
    return undefined;
  }

  return readKind(parsed.kind);
}

function leadingFrontmatter(source: string): string | undefined {
  const lines = source.split("\n");
  if (stripTrailingCarriageReturn(lines[0] ?? "") !== "---") {
    return undefined;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (stripTrailingCarriageReturn(lines[index] ?? "") === "---") {
      return lines.slice(1, index).join("\n");
    }
  }

  return undefined;
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function readKind(value: unknown): string | undefined {
  return value === undefined ? undefined : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
