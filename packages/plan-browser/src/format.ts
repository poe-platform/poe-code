import path from "node:path";
import { parsePlan, type PipelineTask } from "@poe-code/pipeline";
import {
  parseExperimentFrontmatter,
  type ExperimentFrontmatter
} from "@poe-code/experiment-loop";
import { parseFrontmatter, type RalphFrontmatter } from "@poe-code/ralph";
import { parseSuperintendentDoc } from "@poe-code/superintendent";
import { parseDocument, stringify } from "yaml";
import type { DiscoveryFs, PlanEntry, SavedForLaterMetadata } from "./types.js";

const FRONTMATTER_FENCE = "---";

function isPipelineTaskDone(task: PipelineTask): boolean {
  if (typeof task.status === "string") {
    return task.status === "done";
  }

  const statuses = Object.values(task.status);
  return statuses.length > 0 && statuses.every((status) => status === "done");
}

export function formatPipelineProgress(content: string): string {
  const plan = parsePlan(content);
  const done = plan.tasks.filter((task) => isPipelineTaskDone(task)).length;
  return `${done}/${plan.tasks.length} done`;
}

export function formatRalphDetail(frontmatter: RalphFrontmatter): string {
  const parts: string[] = [];

  if (frontmatter.agent !== undefined) {
    parts.push(Array.isArray(frontmatter.agent) ? frontmatter.agent.join(", ") : frontmatter.agent);
  }

  parts.push(
    frontmatter.status.state !== "open" || frontmatter.status.iteration > 0
      ? `${frontmatter.status.state} ${frontmatter.status.iteration}`
      : "open"
  );

  return parts.join(" · ");
}

export function formatExperimentDetail(
  frontmatter: ExperimentFrontmatter,
  state: string
): string {
  const parts: string[] = [];

  const metrics = frontmatter.metric === undefined
    ? []
    : Array.isArray(frontmatter.metric)
      ? frontmatter.metric
      : [frontmatter.metric];
  if (metrics.length > 0) {
    const directions = Array.from(new Set(metrics.map((metric) => metric.direction)));
    parts.push(directions.join("/"));
  }

  parts.push(state);

  return parts.join(" · ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function parseSavedForLaterMetadata(value: unknown): SavedForLaterMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const reasonValue = getOwnEntry(value, "reason");
  const reason = typeof reasonValue === "string" && reasonValue.trim().length > 0
    ? reasonValue.trim()
    : undefined;

  return reason === undefined ? {} : { reason };
}

function stripBom(content: string): string {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}

function normalizeLineEndings(content: string): string {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function readOpeningLineBreak(content: string): "\n" | "\r\n" | undefined {
  if (!content.startsWith(FRONTMATTER_FENCE)) {
    return undefined;
  }

  const nextCharacter = content[FRONTMATTER_FENCE.length];
  if (nextCharacter === "\n") {
    return "\n";
  }

  if (nextCharacter === "\r" && content[FRONTMATTER_FENCE.length + 1] === "\n") {
    return "\r\n";
  }

  return nextCharacter === undefined ? "\n" : undefined;
}

function findClosingFence(content: string, searchFrom: number, filePath: string): number {
  let currentIndex = searchFrom - 1;

  while (currentIndex < content.length) {
    const candidateIndex = content.indexOf(`\n${FRONTMATTER_FENCE}`, currentIndex);

    if (candidateIndex === -1) {
      throw new Error(`${filePath}: missing YAML frontmatter end delimiter (---)`);
    }

    const fenceEnd = candidateIndex + FRONTMATTER_FENCE.length + 1;
    const nextCharacter = content[fenceEnd];

    if (nextCharacter === "\n" || nextCharacter === undefined) {
      return candidateIndex;
    }

    if (nextCharacter === "\r" && content[fenceEnd + 1] === "\n") {
      return candidateIndex;
    }

    currentIndex = fenceEnd;
  }

  throw new Error(`${filePath}: missing YAML frontmatter end delimiter (---)`);
}

function readBody(content: string, bodyStart: number): string {
  const nextCharacter = content[bodyStart];

  if (nextCharacter === "\n") {
    return content.slice(bodyStart + 1);
  }

  if (nextCharacter === "\r" && content[bodyStart + 1] === "\n") {
    return content.slice(bodyStart + 2);
  }

  return content.slice(bodyStart);
}

export function splitFrontmatter(content: string, filePath: string): {
  body: string;
  data: Record<string, unknown> | undefined;
} {
  const normalizedContent = normalizeLineEndings(stripBom(content));
  const openingLineBreak = readOpeningLineBreak(normalizedContent);

  if (openingLineBreak === undefined) {
    return {
      body: normalizedContent,
      data: undefined
    };
  }

  const frontmatterStart = FRONTMATTER_FENCE.length + openingLineBreak.length;
  const closingFenceIndex = findClosingFence(normalizedContent, frontmatterStart, filePath);
  const frontmatterEnd =
    normalizedContent[closingFenceIndex - 1] === "\r" ? closingFenceIndex - 1 : closingFenceIndex;
  const document = parseDocument(normalizedContent.slice(frontmatterStart, frontmatterEnd));

  if (document.errors.length > 0) {
    throw new Error(`${filePath}: invalid YAML frontmatter: ${document.errors[0]?.message}`);
  }

  const parsed = document.toJSON();

  return {
    body: readBody(normalizedContent, closingFenceIndex + FRONTMATTER_FENCE.length + 1),
    data: isRecord(parsed) ? parsed : {}
  };
}

export function readSavedForLaterMetadata(
  content: string,
  filePath: string
): SavedForLaterMetadata | undefined {
  const format = resolveFormatFromPath(filePath);
  let data: Record<string, unknown> | undefined;

  if (format === "yaml") {
    const document = parseDocument(normalizeLineEndings(stripBom(content)));
    if (document.errors.length > 0) {
      throw new Error(`${filePath}: invalid YAML: ${document.errors[0]?.message}`);
    }
    const parsed = document.toJSON();
    data = isRecord(parsed) ? parsed : undefined;
  } else {
    data = splitFrontmatter(content, filePath).data;
  }

  return data === undefined
    ? undefined
    : parseSavedForLaterMetadata(getOwnEntry(data, "saved_for_later"));
}

function setSavedForLaterReasonInYaml(yamlContent: string, filePath: string, reason: string): string {
  const document = parseDocument(yamlContent.trim().length > 0 ? yamlContent : "{}");
  if (document.errors.length > 0) {
    throw new Error(`${filePath}: invalid YAML: ${document.errors[0]?.message}`);
  }

  const parsed = document.toJSON();
  const data = isRecord(parsed) ? { ...parsed } : {};
  const currentMetadata = getOwnEntry(data, "saved_for_later");
  data.saved_for_later = {
    ...(isRecord(currentMetadata) ? currentMetadata : {}),
    reason
  };

  return stringify(data).trimEnd();
}

export function writeSavedForLaterReason(
  content: string,
  filePath: string,
  reason: string
): string {
  const format = resolveFormatFromPath(filePath);

  if (format === "yaml") {
    return `${setSavedForLaterReasonInYaml(normalizeLineEndings(stripBom(content)), filePath, reason)}\n`;
  }

  const normalizedContent = normalizeLineEndings(stripBom(content));
  const openingLineBreak = readOpeningLineBreak(normalizedContent);
  if (openingLineBreak === undefined) {
    const frontmatter = setSavedForLaterReasonInYaml("", filePath, reason);
    return `---\n${frontmatter}\n---\n${normalizedContent}`;
  }

  const frontmatterStart = FRONTMATTER_FENCE.length + openingLineBreak.length;
  const closingFenceIndex = findClosingFence(normalizedContent, frontmatterStart, filePath);
  const frontmatterYaml = normalizedContent.slice(frontmatterStart, closingFenceIndex);
  const frontmatter = setSavedForLaterReasonInYaml(frontmatterYaml, filePath, reason);
  const body = readBody(normalizedContent, closingFenceIndex + FRONTMATTER_FENCE.length + 1);
  return `---\n${frontmatter}\n---\n${body}`;
}

function formatStateLabel(value: string): string {
  return value.split("_").join(" ");
}

export function formatSuperintendentDetail(frontmatter: Record<string, unknown>): string {
  const statusValue = getOwnEntry(frontmatter, "status");
  const status = isRecord(statusValue) ? statusValue : undefined;
  const stateValue = status === undefined ? undefined : getOwnEntry(status, "state");
  const state = typeof stateValue === "string" ? stateValue.trim() : "";

  if (state === "review") {
    const reviewTurn = status === undefined ? undefined : getOwnEntry(status, "review_turn");
    return typeof reviewTurn === "number"
      ? `review ${reviewTurn}`
      : "review";
  }

  if (state.length > 0) {
    return formatStateLabel(state);
  }

  return "in progress";
}

export function getLastExperimentState(journalContent: string): string {
  const lines = journalContent
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!) as unknown;
      const status = isRecord(parsed) ? getOwnEntry(parsed, "status") : undefined;
      if (status === "keep" || status === "discard") {
        return status;
      }
    } catch {
      continue;
    }
  }

  return "open";
}

function extractFirstHeading(content: string): string | undefined {
  let insideFence = false;

  for (const sourceLine of normalizeLineEndings(content).split("\n")) {
    const line = sourceLine.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      insideFence = !insideFence;
      continue;
    }

    if (!insideFence && line.startsWith("# ")) {
      return line.slice(2).trim() || undefined;
    }
  }

  return undefined;
}

export function deriveMarkdownTitle(content: string, fallbackName: string): string {
  return extractFirstHeading(content) ?? fallbackName;
}

function formatPipelineTaskDetails(task: PipelineTask): string | null {
  if (typeof task.status === "string") {
    return null;
  }

  const entries = Object.entries(task.status).map(([name, status]) => `${name}=${status}`);
  return entries.length > 0 ? `Step status: ${entries.join(", ")}` : null;
}

export function formatPipelinePlanMarkdown(options: {
  title: string;
  content: string;
}): string {
  const plan = parsePlan(options.content);
  const lines: string[] = [
    `# ${options.title}`,
    "",
    `Status: ${formatPipelineProgress(options.content)}`,
    "",
    "## Tasks",
    ""
  ];

  for (const task of plan.tasks) {
    const mark = isPipelineTaskDone(task) ? "x" : " ";
    lines.push(`- [${mark}] ${task.title} (\`${task.id}\`)`);

    const detail = formatPipelineTaskDetails(task);
    if (detail) {
      lines.push(`  - ${detail}`);
    }

    for (const promptLine of task.prompt.split("\n")) {
      lines.push(`  > ${promptLine}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function resolveExperimentJournalPath(absolutePath: string): string {
  return path.join(
    path.dirname(absolutePath),
    `${path.basename(absolutePath, path.extname(absolutePath))}.journal.jsonl`
  );
}

export async function readExperimentState(
  fs: Pick<DiscoveryFs, "readFile">,
  absolutePath: string
): Promise<string> {
  try {
    const content = await fs.readFile(resolveExperimentJournalPath(absolutePath), "utf8");
    return getLastExperimentState(content);
  } catch (error) {
    const code = isRecord(error) ? getOwnEntry(error, "code") : undefined;
    if (code === "ENOENT") {
      return "open";
    }
    throw error;
  }
}

export async function loadPlanPreviewMarkdown(
  entry: Pick<PlanEntry, "absolutePath" | "format" | "kind" | "title">,
  fs: Pick<DiscoveryFs, "readFile">
): Promise<string> {
  const content = await fs.readFile(entry.absolutePath, "utf8");

  if (entry.kind === "pipeline") {
    return formatPipelinePlanMarkdown({
      title: entry.title,
      content
    });
  }

  return content;
}

function resolveFormatFromPath(filePath: string): PlanEntry["format"] {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "yaml";
  }

  return "markdown";
}

export async function readPlanMetadata(options: {
  kind: PlanEntry["kind"];
  absolutePath: string;
  path: string;
  fs: Pick<DiscoveryFs, "readFile">;
  content?: string;
}): Promise<Pick<PlanEntry, "title" | "detail" | "format">> {
  const content = normalizeLineEndings(
    options.content ?? await options.fs.readFile(options.absolutePath, "utf8")
  );
  const fallbackName = path.basename(options.path);

  if (options.kind === "pipeline") {
    return {
      title: fallbackName,
      detail: formatPipelineProgress(content),
      format: resolveFormatFromPath(options.path)
    };
  }

  if (options.kind === "ralph") {
    const parsed = parseFrontmatter(content);
    return {
      title: deriveMarkdownTitle(parsed.body, fallbackName),
      detail: formatRalphDetail(parsed.data),
      format: "markdown"
    };
  }

  if (options.kind === "experiment") {
    const parsed = parseExperimentFrontmatter(content);
    const state = await readExperimentState(options.fs, options.absolutePath);
    return {
      title: deriveMarkdownTitle(parsed.body, fallbackName),
      detail: formatExperimentDetail(parsed.frontmatter, state),
      format: "markdown"
    };
  }

  if (options.kind === "superintendent") {
    const parsed = parseSuperintendentDoc(options.absolutePath, content);
    return {
      title: deriveMarkdownTitle(parsed.body, fallbackName),
      detail: formatSuperintendentDetail(parsed.frontmatter),
      format: "markdown"
    };
  }

  if (options.kind === "superintendent-base") {
    const parsed = splitFrontmatter(content, options.path);
    return {
      title: deriveMarkdownTitle(parsed.body, fallbackName),
      detail: "base doc",
      format: "markdown"
    };
  }

  const parsed = splitFrontmatter(content, options.path);
  const heading = extractFirstHeading(parsed.body);

  return {
    title: heading ?? fallbackName,
    detail: heading ?? "design doc",
    format: resolveFormatFromPath(options.path)
  };
}
