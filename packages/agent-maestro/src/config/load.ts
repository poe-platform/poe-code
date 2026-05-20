import { readFile } from "node:fs/promises";
import path from "node:path";
import { readMarkdown } from "@poe-code/markdown-reader";

export interface WorkflowDefinition {
  sourcePath: string;
  config: unknown;
  promptTemplate: string;
}

export type WorkflowLoadErrorCode = "file_not_found" | "invalid_yaml";

export class WorkflowLoadError extends Error {
  readonly code: WorkflowLoadErrorCode;

  constructor(code: WorkflowLoadErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorkflowLoadError";
    this.code = code;
  }
}

export async function loadWorkflow(workflowPath: string): Promise<WorkflowDefinition> {
  const sourcePath = path.resolve(workflowPath);
  const source = await readWorkflowFile(sourcePath);
  const config = await readWorkflowConfig(sourcePath);

  return {
    sourcePath,
    config,
    promptTemplate: splitPromptTemplate(source)
  };
}

async function readWorkflowFile(sourcePath: string): Promise<string> {
  try {
    return await readFile(sourcePath, "utf8");
  } catch (error) {
    throw new WorkflowLoadError("file_not_found", `Missing workflow file at ${sourcePath}.`, {
      cause: error
    });
  }
}

async function readWorkflowConfig(sourcePath: string): Promise<unknown> {
  try {
    return (await readMarkdown({ file: sourcePath })).frontmatter;
  } catch (error) {
    throw new WorkflowLoadError(
      "invalid_yaml",
      `Invalid workflow frontmatter in ${sourcePath}.`,
      { cause: error }
    );
  }
}

function splitPromptTemplate(source: string): string {
  if (!startsWithFrontmatterFence(source)) {
    return source;
  }

  const opening = readLine(source, 0);

  if (stripBom(opening.content) !== "---") {
    return source;
  }

  let position = opening.next;

  while (position <= source.length) {
    const line = readLine(source, position);

    if (line.content === "---") {
      return stripSingleLeadingBlankLine(source.slice(line.next));
    }

    if (line.next <= position || line.next >= source.length) {
      return source;
    }

    position = line.next;
  }

  return source;
}

function startsWithFrontmatterFence(source: string): boolean {
  return source.startsWith("---") || source.startsWith("\uFEFF---");
}

function readLine(source: string, start: number): { content: string; next: number } {
  let position = start;

  while (position < source.length) {
    const char = source[position];

    if (char === "\n") {
      return {
        content: trimCarriageReturn(source.slice(start, position)),
        next: position + 1
      };
    }

    position += 1;
  }

  return {
    content: trimCarriageReturn(source.slice(start)),
    next: source.length
  };
}

function trimCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function stripBom(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

function stripSingleLeadingBlankLine(value: string): string {
  if (value.startsWith("\r\n")) {
    return value.slice(2);
  }

  if (value.startsWith("\n") || value.startsWith("\r")) {
    return value.slice(1);
  }

  return value;
}
