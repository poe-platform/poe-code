import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { CliContainer } from "../container.js";
import { resolveWorkflowPath } from "@poe-code/agent-harness-tools";
import { resolvePlanDirectory as resolveSourcePlanDirectory } from "./plan.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";

export interface BuildPipelineInitPromptOptions {
  question?: string;
  sourceDocPath: string;
  sourceDocContent: string;
  skillContent: string;
}

export interface PipelineInitSource {
  absolutePath: string;
  relativePath: string;
  title: string;
}

type DiscoveryFs = Pick<CliContainer["fs"], "readFile" | "readdir" | "stat">;

export function buildPipelineInitPrompt(options: BuildPipelineInitPromptOptions): string {
  const trimmedQuestion = options.question?.trim() ?? "";
  const sourceTitle = extractTitle(options.sourceDocPath, options.sourceDocContent);
  const userRequest = trimmedQuestion.length > 0
    ? trimmedQuestion
    : `Add pipeline frontmatter to "${sourceTitle}" in place, based on the document below. Do not create a separate plan file and do not ask for more input.`;
  const fence = createMarkdownFence(options.sourceDocContent);

  return [
    "Follow the skill below to add pipeline frontmatter to an existing source document in place.",
    `Edit ${options.sourceDocPath} directly — do not write a new plan file.`,
    "",
    options.skillContent,
    "",
    "---",
    "",
    "User request:",
    userRequest,
    "",
    "Source document:",
    `Path: ${options.sourceDocPath}`,
    `${fence}markdown`,
    options.sourceDocContent,
    fence
  ].join("\n");
}

export async function discoverPipelineInitSources(options: {
  container: CliContainer;
}): Promise<PipelineInitSource[]> {
  const sourcePlanDirectory = await resolveSourcePlanDirectory(options.container);
  const sourceAbsoluteDirectory = resolveWorkflowPath(
    sourcePlanDirectory,
    options.container.env.cwd,
    options.container.env.homeDir
  );
  const sourceFiles = await discoverMarkdownFiles(options.container.fs, sourceAbsoluteDirectory);
  const sources: PipelineInitSource[] = [];

  for (const file of sourceFiles) {
    const content = await options.container.fs.readFile(file.absolutePath, "utf8");
    if (hasPipelineFrontmatter(content)) {
      continue;
    }

    sources.push({
      absolutePath: file.absolutePath,
      relativePath: file.relativePath,
      title: extractTitle(file.absolutePath, content)
    });
  }

  return sources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function hasPipelineFrontmatter(content: string): boolean {
  const normalized = content.startsWith("\ufeff") ? content.slice(1) : content;
  if (!normalized.startsWith("---")) {
    return false;
  }

  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") {
    return false;
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) {
    return false;
  }

  const yaml = lines.slice(1, closingIndex).join("\n");
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch {
    return false;
  }

  return (
    typeof parsed === "object"
    && parsed !== null
    && (parsed as { kind?: unknown }).kind === "pipeline"
  );
}

async function discoverMarkdownFiles(
  fs: DiscoveryFs,
  absoluteDirectory: string,
  parentRelativePath = ""
): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  let entries: string[];
  try {
    entries = await fs.readdir(absoluteDirectory);
  } catch (error) {
    if (isMissingDirectory(error)) {
      return [];
    }
    throw error;
  }

  const markdownFiles: Array<{ absolutePath: string; relativePath: string }> = [];

  for (const entry of [...entries].sort((left, right) => left.localeCompare(right))) {
    const absolutePath = path.join(absoluteDirectory, entry);
    const relativePath = parentRelativePath.length > 0
      ? path.join(parentRelativePath, entry)
      : entry;
    const stat = await fs.stat(absolutePath);

    if (stat.isDirectory()) {
      if (entry === "archive") {
        continue;
      }

      markdownFiles.push(...await discoverMarkdownFiles(fs, absolutePath, relativePath));
      continue;
    }

    if (!stat.isFile() || !entry.toLowerCase().endsWith(".md")) {
      continue;
    }

    markdownFiles.push({
      absolutePath,
      relativePath
    });
  }

  return markdownFiles;
}

function extractTitle(filePath: string, content: string): string {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("# ")) {
      continue;
    }

    const title = trimmed.slice(2).trim();
    if (title.length > 0) {
      return title;
    }
  }

  return path.basename(filePath, path.extname(filePath));
}

function createMarkdownFence(content: string): string {
  return "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
}

function longestBacktickRun(content: string): number {
  let longest = 0;
  let current = 0;

  for (const char of content) {
    if (char === "`") {
      current += 1;
      if (current > longest) {
        longest = current;
      }
      continue;
    }

    current = 0;
  }

  return longest;
}

function isMissingDirectory(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}
