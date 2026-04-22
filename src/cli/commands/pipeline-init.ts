import path from "node:path";
import type { CliContainer } from "../container.js";
import {
  readMergedDocument,
  resolveScope
} from "@poe-code/poe-code-config";
import { resolveWorkflowPath } from "@poe-code/agent-kit";
import { resolvePlanDirectory as resolvePipelinePlanDirectory } from "@poe-code/pipeline";
import { pipelineConfigScope } from "../../services/config.js";
import { resolvePlanDirectory as resolveSourcePlanDirectory } from "./plan.js";

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
  const userRequest =
    trimmedQuestion.length > 0
      ? trimmedQuestion
      : `Create a pipeline plan for "${sourceTitle}" based on the source document below. Treat the source document as the user request and do not ask the user for more input.`;
  const fence = createMarkdownFence(options.sourceDocContent);

  return [
    "Follow the skill below to initialize a pipeline plan from an existing source document.",
    "",
    options.skillContent,
    "",
    "---",
    "",
    "Edit the source document in place by prepending valid YAML frontmatter.",
    "Do not create a new file.",
    `The final result must remain at: ${options.sourceDocPath}`,
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
  const pipelineAbsoluteDirectory = await resolveConfiguredPipelinePlanDirectory(options.container);
  const existingPlanNames = await discoverExistingPipelinePlanNames(
    options.container.fs,
    pipelineAbsoluteDirectory
  );
  const sourceFiles = await discoverMarkdownFiles(options.container.fs, sourceAbsoluteDirectory);
  const sources: PipelineInitSource[] = [];

  for (const file of sourceFiles) {
    const sourceName = path.basename(file.relativePath, path.extname(file.relativePath));
    if (existingPlanNames.has(`plan-${sourceName}`)) {
      continue;
    }

    const content = await options.container.fs.readFile(file.absolutePath, "utf8");
    sources.push({
      absolutePath: file.absolutePath,
      relativePath: file.relativePath,
      title: extractTitle(file.absolutePath, content)
    });
  }

  return sources.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function resolveConfiguredPipelinePlanDirectory(container: CliContainer): Promise<string> {
  const document = await readMergedDocument(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const config = resolveScope(
    pipelineConfigScope.schema,
    document[pipelineConfigScope.scope],
    container.env.variables
  );
  const planDirectory = config.plan_directory?.trim();

  return resolvePipelinePlanDirectory({
    cwd: container.env.cwd,
    homeDir: container.env.homeDir,
    ...(planDirectory ? { planDirectory } : {})
  });
}

async function discoverExistingPipelinePlanNames(
  fs: DiscoveryFs,
  absoluteDirectory: string
): Promise<Set<string>> {
  let entries: string[];
  try {
    entries = await fs.readdir(absoluteDirectory);
  } catch (error) {
    if (isMissingDirectory(error)) {
      return new Set();
    }
    throw error;
  }

  const planNames = new Set<string>();

  for (const entry of [...entries].sort((left, right) => left.localeCompare(right))) {
    const lower = entry.toLowerCase();
    if (!lower.startsWith("plan-")) {
      continue;
    }
    if (!lower.endsWith(".md") && !lower.endsWith(".yaml")) {
      continue;
    }

    const absolutePath = path.join(absoluteDirectory, entry);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    planNames.add(path.basename(entry, path.extname(entry)));
  }

  return planNames;
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
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}
