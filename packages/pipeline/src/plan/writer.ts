import { randomUUID } from "node:crypto";
import { parseDocument, isMap, isSeq, type YAMLMap, type YAMLSeq } from "yaml";
import { hasOwnErrorCode } from "../error-codes.js";
import type { PipelineFileSystem, PipelineFinalizationStatus, PipelineStatus } from "../types.js";
import { pipelineDocumentSchemaId } from "./parser.js";
import { withPlanLock } from "./lock.js";

type WritableFs = Pick<PipelineFileSystem, "readFile" | "writeFile" | "lstat" | "rename" | "unlink">;
type WritableDocument = MarkdownPlanDocument | YamlPlanDocument;
type PlanWriteOptions = {
  fs: WritableFs;
  planPath: string;
  signal?: AbortSignal;
};

type MarkdownPlanDocument = {
  kind: "markdown";
  bom: string;
  lineBreak: "\n" | "\r\n";
  frontmatterText: string;
  frontmatterSuffix: string;
  body: string;
};

type YamlPlanDocument = {
  kind: "yaml";
};

function getTasksNode(document: ReturnType<typeof parseDocument>): YAMLSeq {
  const tasksNode = document.get("tasks", true);
  if (!tasksNode || !isSeq(tasksNode)) {
    throw new Error('Invalid plan YAML: expected "tasks" to be a sequence.');
  }
  return tasksNode as YAMLSeq;
}

function getTaskNode(tasksNode: YAMLSeq, taskId: string): YAMLMap {
  for (const item of tasksNode.items) {
    if (!isMap(item)) {
      continue;
    }
    if (item.get("id") === taskId) {
      return item as YAMLMap;
    }
  }
  throw new Error(`Task "${taskId}" not found in plan.`);
}

function getTopLevelMap(document: ReturnType<typeof parseDocument>): YAMLMap {
  if (!document.contents || !isMap(document.contents)) {
    throw new Error("Invalid plan YAML: expected a top-level object.");
  }

  return document.contents as YAMLMap;
}

function reorderTopLevelKeys(map: YAMLMap, keys: string[]): void {
  const remaining = [...map.items];
  const ordered = keys.flatMap((key) => {
    const index = remaining.findIndex((item) => item.key?.toString() === key);

    return index === -1 ? [] : remaining.splice(index, 1);
  });

  map.items = [...ordered, ...remaining];
}

function canonicalizeDocument(document: ReturnType<typeof parseDocument>): void {
  const map = getTopLevelMap(document);

  map.delete("maxExperiments");
  map.delete("metricTimeout");
  map.delete("planPath");

  map.set("$schema", pipelineDocumentSchemaId);
  map.set("kind", "pipeline");
  map.set("version", 1);
  reorderTopLevelKeys(map, ["$schema", "kind", "version"]);
}

export async function readPlanFile(
  fs: Pick<PipelineFileSystem, "readFile">,
  planPath: string
): Promise<string> {
  return fs.readFile(planPath, "utf8");
}

function splitWritableDocument(content: string): WritableDocument {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const normalizedContent = bom ? content.slice(1) : content;
  const lineBreak = readOpeningLineBreak(normalizedContent);

  if (lineBreak === undefined) {
    return { kind: "yaml" };
  }

  const frontmatterStart = 3 + lineBreak.length;
  const closingFenceIndex = findClosingFence(normalizedContent, frontmatterStart);
  const frontmatterEnd = readFrontmatterEnd(normalizedContent, closingFenceIndex);
  const bodyStart = readBodyStart(normalizedContent, closingFenceIndex + 4);

  return {
    kind: "markdown",
    bom,
    lineBreak,
    frontmatterText: normalizedContent.slice(frontmatterStart, frontmatterEnd),
    frontmatterSuffix: normalizedContent.slice(frontmatterEnd, bodyStart),
    body: normalizedContent.slice(bodyStart)
  };
}

function readOpeningLineBreak(content: string): "\n" | "\r\n" | undefined {
  if (!content.startsWith("---")) {
    return undefined;
  }

  const nextCharacter = content[3];
  if (nextCharacter === "\n") {
    return "\n";
  }

  if (nextCharacter === "\r" && content[4] === "\n") {
    return "\r\n";
  }

  return nextCharacter === undefined ? "\n" : undefined;
}

function findClosingFence(content: string, searchFrom: number): number {
  let currentIndex = searchFrom - 1;

  while (currentIndex < content.length) {
    const candidateIndex = content.indexOf("\n---", currentIndex);

    if (candidateIndex === -1) {
      throw new Error("Invalid plan markdown: missing closing frontmatter delimiter.");
    }

    const fenceEnd = candidateIndex + 4;
    const nextCharacter = content[fenceEnd];

    if (nextCharacter === "\n" || nextCharacter === undefined) {
      return candidateIndex;
    }

    if (nextCharacter === "\r" && content[fenceEnd + 1] === "\n") {
      return candidateIndex;
    }

    currentIndex = fenceEnd;
  }

  throw new Error("Invalid plan markdown: missing closing frontmatter delimiter.");
}

function readFrontmatterEnd(content: string, closingFenceIndex: number): number {
  return content[closingFenceIndex - 1] === "\r" ? closingFenceIndex - 1 : closingFenceIndex;
}

function readBodyStart(content: string, bodyStart: number): number {
  const nextCharacter = content[bodyStart];

  if (nextCharacter === "\n") {
    return bodyStart + 1;
  }

  if (nextCharacter === "\r" && content[bodyStart + 1] === "\n") {
    return bodyStart + 2;
  }

  return bodyStart;
}

function formatYamlContent(serialized: string, lineBreak: "\n" | "\r\n"): string {
  const normalized = serialized.endsWith("\n") ? serialized.slice(0, -1) : serialized;

  if (lineBreak === "\n") {
    return normalized;
  }

  return normalized.replaceAll("\n", lineBreak);
}

function serializeDocument(
  parts: WritableDocument,
  document: ReturnType<typeof parseDocument>
): string {
  if (document.errors.length > 0) {
    throw new Error(`Invalid plan YAML: ${document.errors[0]?.message ?? "failed to parse plan."}`);
  }

  if (parts.kind === "yaml") {
    return document.toString();
  }

  return [
    parts.bom,
    "---",
    parts.lineBreak,
    formatYamlContent(document.toString(), parts.lineBreak),
    parts.frontmatterSuffix,
    parts.body
  ].join("");
}

export async function writeTaskStatus(options: PlanWriteOptions & {
  taskId: string;
  status: PipelineStatus;
  stepName?: string;
  finalization?: PipelineFinalizationStatus;
}): Promise<void> {
  await updatePlanDocument(options, (document) => {
    const taskNode = getTaskNode(getTasksNode(document), options.taskId);
    if (options.stepName) {
      const statusNode = taskNode.get("status", true);
      if (!statusNode || !isMap(statusNode)) {
        throw new Error(`Task "${options.taskId}" does not use step statuses.`);
      }
      statusNode.set(options.stepName, options.status);
    } else {
      taskNode.set("status", options.status);
    }
    if (options.finalization !== undefined) {
      document.set("finalization", options.finalization);
    }
    return true;
  });
}

export async function writeFinalizationStatus(options: PlanWriteOptions & {
  status: PipelineFinalizationStatus;
}): Promise<boolean> {
  return updatePlanDocument(options, (document) => {
    getTasksNode(document);
    const current = document.toJS() as { tasks: Array<{ status?: unknown }> };
    const allDone = current.tasks.every((task) => {
      const status = task?.status;
      if (typeof status === "string") {
        return status.trim().toLowerCase() === "done";
      }
      if (status && typeof status === "object" && !Array.isArray(status)) {
        const statuses = Object.values(status);
        return statuses.length > 0 && statuses.every(
          (value) => typeof value === "string" && value.trim().toLowerCase() === "done"
        );
      }
      throw new Error("Invalid task status while finalizing plan.");
    });
    if (!allDone) {
      return false;
    }
    document.set("finalization", options.status);
    return true;
  });
}

async function updatePlanDocument(
  options: PlanWriteOptions,
  mutate: (document: ReturnType<typeof parseDocument>) => boolean
): Promise<boolean> {
  return withPlanLock({
    fs: options.fs,
    planPath: options.planPath,
    kind: "status",
    signal: options.signal,
    operation: () => persistPlanDocument(options, mutate)
  });
}

async function persistPlanDocument(
  options: PlanWriteOptions,
  mutate: (document: ReturnType<typeof parseDocument>) => boolean
): Promise<boolean> {
  if ((await options.fs.lstat(options.planPath)).isSymbolicLink()) {
    throw new Error(`Refusing to write task status through symbolic link: ${options.planPath}`);
  }
  const content = await readPlanFile(options.fs, options.planPath);
  const parts = splitWritableDocument(content);
  const document = parseDocument(parts.kind === "markdown" ? parts.frontmatterText : content);
  if (!mutate(document)) {
    return false;
  }

  canonicalizeDocument(document);

  const tempPath = `${options.planPath}.${process.pid}.${randomUUID()}.tmp`;
  let tempCreated = false;
  try {
    await options.fs.writeFile(tempPath, serializeDocument(parts, document), {
      encoding: "utf8",
      flag: "wx"
    });
    tempCreated = true;
    if ((await options.fs.lstat(options.planPath)).isSymbolicLink()) {
      throw new Error(`Refusing to write task status through symbolic link: ${options.planPath}`);
    }
    await options.fs.rename(tempPath, options.planPath);
    tempCreated = false;
    return true;
  } catch (error) {
    if (tempCreated || !isAlreadyExists(error)) {
      await options.fs.unlink(tempPath).catch(() => undefined);
    }
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}
