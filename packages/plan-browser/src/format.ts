import path from "node:path";
import { parsePlan, type PipelineTask } from "@poe-code/pipeline";
import {
  parseExperimentFrontmatter,
  type ExperimentFrontmatter
} from "@poe-code/experiment-loop";
import { parseFrontmatter, type RalphFrontmatter } from "@poe-code/ralph";
import type { DiscoveryFs, PlanEntry } from "./types.js";

function isPipelineTaskDone(task: PipelineTask): boolean {
  if (typeof task.status === "string") {
    return task.status === "done";
  }

  return Object.values(task.status).every((status) => status === "done");
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

  if (frontmatter.iterations !== undefined) {
    parts.push(`×${frontmatter.iterations}`);
  }

  if (frontmatter.status.state !== "open" || frontmatter.status.iteration > 0) {
    parts.push(`${frontmatter.status.state} ${frontmatter.status.iteration}`);
  } else {
    parts.push("open");
  }

  return parts.join(" · ");
}

export function formatExperimentDetail(
  frontmatter: ExperimentFrontmatter,
  state: string
): string {
  const parts: string[] = [];

  if (frontmatter.agent !== undefined) {
    parts.push(Array.isArray(frontmatter.agent) ? frontmatter.agent.join(", ") : frontmatter.agent);
  }

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

export function getLastExperimentState(journalContent: string): string {
  const lines = journalContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!) as { status?: string };
      if (typeof parsed.status === "string" && parsed.status.length > 0) {
        return parsed.status;
      }
    } catch {
      continue;
    }
  }

  return "open";
}

export function deriveMarkdownTitle(content: string, fallbackName: string): string {
  const heading = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));

  return heading ? heading.slice(2).trim() || fallbackName : fallbackName;
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
  } catch {
    return "open";
  }
}

export async function loadPlanPreviewMarkdown(
  entry: Pick<PlanEntry, "absolutePath" | "format" | "source" | "title">,
  fs: Pick<DiscoveryFs, "readFile">
): Promise<string> {
  const content = await fs.readFile(entry.absolutePath, "utf8");

  if (entry.source === "pipeline") {
    return formatPipelinePlanMarkdown({
      title: entry.title,
      content
    });
  }

  return content;
}

export async function readPlanMetadata(options: {
  source: PlanEntry["source"];
  absolutePath: string;
  path: string;
  fs: Pick<DiscoveryFs, "readFile">;
}): Promise<Pick<PlanEntry, "title" | "status" | "format">> {
  const content = await options.fs.readFile(options.absolutePath, "utf8");
  const fallbackName = path.basename(options.path);

  if (options.source === "pipeline") {
    return {
      title: fallbackName,
      status: formatPipelineProgress(content),
      format: "yaml"
    };
  }

  if (options.source === "ralph") {
    const parsed = parseFrontmatter(content);
    return {
      title: deriveMarkdownTitle(parsed.body, fallbackName),
      status: formatRalphDetail(parsed.data),
      format: "markdown"
    };
  }

  const parsed = parseExperimentFrontmatter(content);
  const state = await readExperimentState(options.fs, options.absolutePath);
  return {
    title: deriveMarkdownTitle(parsed.body, fallbackName),
    status: formatExperimentDetail(parsed.frontmatter, state),
    format: "markdown"
  };
}
