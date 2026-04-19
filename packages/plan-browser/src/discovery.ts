import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { parseDocument } from "yaml";
import { readMergedDocument } from "@poe-code/poe-code-config";
import { readPlanMetadata } from "./format.js";
import type { DiscoveryFs, PlanEntry, PlanKind } from "./types.js";

const FRONTMATTER_FENCE = "---";

function createDefaultFs(): DiscoveryFs {
  return {
    readFile: fsPromises.readFile as DiscoveryFs["readFile"],
    writeFile: fsPromises.writeFile as DiscoveryFs["writeFile"],
    readdir: fsPromises.readdir,
    stat: async (filePath) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        mtimeMs: stat.mtimeMs
      };
    },
    mkdir: async (directoryPath, mkdirOptions) => {
      await fsPromises.mkdir(directoryPath, mkdirOptions);
    },
    rename: fsPromises.rename,
    unlink: fsPromises.unlink
  };
}

function isNotFound(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function resolveAbsoluteDirectory(dir: string, cwd: string, homeDir: string): string {
  if (dir.startsWith("~/")) {
    return path.join(homeDir, dir.slice(2));
  }

  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

function getPlanTypeLabel(kind: PlanKind): string {
  switch (kind) {
    case "plan":
      return "Plan";
    case "pipeline":
      return "Pipeline";
    case "experiment":
      return "Experiment";
    case "ralph":
      return "Ralph";
    case "superintendent":
      return "Superintendent";
    case "superintendent-base":
      return "Superintendent Base";
  }
}

function getPlanRunner(kind: PlanKind): PlanEntry["runner"] {
  switch (kind) {
    case "pipeline":
    case "experiment":
    case "ralph":
    case "superintendent":
      return kind;
    default:
      return undefined;
  }
}

async function resolveSharedPlanDirectory(options: {
  fs: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  variables?: Record<string, string | undefined>;
}): Promise<string> {
  const envValue = options.variables?.POE_PLAN_DIRECTORY?.trim();
  if (envValue) {
    return envValue;
  }

  const document = await readMergedDocument(
    options.fs as Parameters<typeof readMergedDocument>[0],
    options.configPath,
    options.projectConfigPath
  );
  const configured = document.plan?.plan_directory;

  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim()
    : "docs/plans";
}

function stripBom(content: string): string {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFrontmatter(content: string, filePath: string): Record<string, unknown> | undefined {
  const normalizedContent = stripBom(content);
  const openingLineBreak = readOpeningLineBreak(normalizedContent);

  if (openingLineBreak === undefined) {
    return undefined;
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
  return isRecord(parsed) ? parsed : {};
}

function toPlanKind(value: unknown, filePath: string): PlanKind {
  if (
    value === "plan" ||
    value === "pipeline" ||
    value === "experiment" ||
    value === "ralph" ||
    value === "superintendent" ||
    value === "superintendent-base"
  ) {
    return value;
  }

  throw new Error(`${filePath}: unsupported frontmatter kind ${JSON.stringify(value)}`);
}

function classifyPlanKind(content: string, filePath: string): PlanKind {
  const frontmatter = readFrontmatter(content, filePath);

  if (frontmatter === undefined) {
    return "plan";
  }

  if (frontmatter.kind === undefined) {
    throw new Error(`${filePath}: missing required frontmatter kind`);
  }

  return toPlanKind(frontmatter.kind, filePath);
}

async function discoverSharedPlans(options: {
  cwd: string;
  homeDir: string;
  fs: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  kind?: PlanKind;
  variables?: Record<string, string | undefined>;
}): Promise<PlanEntry[]> {
  const displayDir = await resolveSharedPlanDirectory(options);
  const absoluteDir = resolveAbsoluteDirectory(displayDir, options.cwd, options.homeDir);

  let entries: string[];
  try {
    entries = await options.fs.readdir(absoluteDir);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const plans: PlanEntry[] = [];
  for (const name of entries) {
    if (!isMarkdownFile(name)) {
      continue;
    }

    const absolutePath = path.join(absoluteDir, name);
    const stat = await options.fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    const displayPath = path.join(displayDir, name);
    const content = await options.fs.readFile(absolutePath, "utf8");
    const kind = classifyPlanKind(content, displayPath);

    if (options.kind && kind !== options.kind) {
      continue;
    }

    const metadata = await readPlanMetadata({
      kind,
      absolutePath,
      path: displayPath,
      fs: options.fs
    });

    plans.push({
      path: displayPath,
      absolutePath,
      kind,
      typeLabel: getPlanTypeLabel(kind),
      runner: getPlanRunner(kind),
      format: metadata.format,
      title: metadata.title,
      detail: metadata.detail,
      updatedAt: stat.mtimeMs
    });
  }

  return plans;
}

export async function discoverAllPlans(options: {
  cwd: string;
  homeDir: string;
  fs?: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  kind?: PlanKind;
  variables?: Record<string, string | undefined>;
}): Promise<PlanEntry[]> {
  const fs = options.fs ?? createDefaultFs();
  const results = await discoverSharedPlans({ ...options, fs });

  return results.sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.path.localeCompare(right.path);
  });
}
