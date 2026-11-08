import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { parsePlan } from "@poe-code/pipeline";
import { comparePlanReadiness } from "@poe-code/agent-harness-tools";
import {
  planConfigScope,
  readMergedDocumentReadonly,
  resolveScope
} from "@poe-code/poe-code-config/core";
import { hasOwnErrorCode } from "./error-codes.js";
import { readPlanMetadata, readSavedForLaterMetadata, splitFrontmatter } from "./format.js";
import type { DiscoveryFs, PlanEntry, PlanKind, PlanReadiness } from "./types.js";

function createDefaultFs(): DiscoveryFs {
  return {
    readFile: fsPromises.readFile as DiscoveryFs["readFile"],
    writeFile: fsPromises.writeFile as DiscoveryFs["writeFile"],
    readdir: fsPromises.readdir,
    realpath: fsPromises.realpath,
    stat: async (filePath) => {
      const stat = await fsPromises.stat(filePath);
      return {
        isFile: () => stat.isFile(),
        isDirectory: () => stat.isDirectory(),
        atimeMs: stat.atimeMs,
        mtimeMs: stat.mtimeMs
      };
    },
    lstat: async (filePath: string) => {
      const stat = await fsPromises.lstat(filePath);
      return { isSymbolicLink: () => stat.isSymbolicLink() };
    },
    mkdir: async (directoryPath, mkdirOptions) => {
      await fsPromises.mkdir(directoryPath, mkdirOptions);
    },
    rename: fsPromises.rename,
    unlink: fsPromises.unlink
  };
}

function isNotFound(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

function getOwnValue(
  record: Record<string, string | undefined> | undefined,
  key: string
): string | undefined {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function resolveAbsoluteDirectory(dir: string, cwd: string, homeDir: string): string {
  if (dir.startsWith("~/")) {
    return path.join(homeDir, dir.slice(2));
  }

  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}

export function isPlanMetaDocument(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === "readme.md";
}

function isSupportedPlanFile(name: string): boolean {
  if (isPlanMetaDocument(name)) {
    return false;
  }

  const lowerName = name.toLowerCase();
  return lowerName.endsWith(".md") || lowerName.endsWith(".yaml") || lowerName.endsWith(".yml");
}

function isYamlPlanFile(name: string): boolean {
  const lowerName = name.toLowerCase();
  return lowerName.endsWith(".yaml") || lowerName.endsWith(".yml");
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

function isSavedForLaterPath(absolutePath: string): boolean {
  return path.basename(path.dirname(absolutePath)) === "later";
}

async function resolveSharedPlanDirectory(options: {
  fs: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  variables?: Record<string, string | undefined>;
}): Promise<string> {
  const envValue = getOwnValue(options.variables, "POE_PLAN_DIRECTORY")?.trim();
  if (envValue) {
    return envValue;
  }

  const document = await readMergedDocumentReadonly(
    options.fs as Parameters<typeof readMergedDocumentReadonly>[0],
    options.configPath,
    options.projectConfigPath
  );
  return resolveScope(planConfigScope.schema, document.plan, options.variables).plan_directory;
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

function classifyPlanKind(content: string, filePath: string, archived = false): PlanKind {
  if (isYamlPlanFile(filePath)) {
    parsePlan(content);
    return "pipeline";
  }

  const { data } = splitFrontmatter(content, filePath);

  if (data === undefined) {
    return "plan";
  }

  if (data.kind === undefined) return "plan";
  if (archived && data.kind === "archived-pipeline-plan") return "plan";
  if (archived) {
    try {
      return toPlanKind(data.kind, filePath);
    } catch {
      return "plan";
    }
  }
  return toPlanKind(data.kind, filePath);
}

function readPlanReadiness(content: string, filePath: string): PlanReadiness {
  const value = splitFrontmatter(content, filePath).data?.readiness;
  if (value === undefined || value === "draft") return "draft";
  if (value === "ready") return value;
  throw new Error(
    `${filePath}: invalid readiness ${JSON.stringify(value)}; expected "draft" or "ready"`
  );
}

async function discoverSharedPlans(options: {
  cwd: string;
  homeDir: string;
  fs: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  kind?: PlanKind;
  archived?: boolean;
  variables?: Record<string, string | undefined>;
}): Promise<PlanEntry[]> {
  const displayDir = await resolveSharedPlanDirectory(options);
  const absoluteDir = resolveAbsoluteDirectory(displayDir, options.cwd, options.homeDir);
  const canonicalDir = await options.fs.realpath(absoluteDir).catch((error: unknown) => {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  });

  if (canonicalDir === undefined) {
    return [];
  }

  if (canonicalDir !== path.resolve(absoluteDir)) {
    throw new Error(`Plan directory must not be a symbolic link: ${displayDir}`);
  }

  if (options.archived === true) {
    return discoverPlanDirectoryEntries({
      ...options,
      absoluteDir: path.join(absoluteDir, "archive"),
      displayDir: path.join(displayDir, "archive"),
      savedForLaterDirectory: false
    });
  }

  const activePlans = await discoverPlanDirectoryEntries({
    ...options,
    absoluteDir,
    displayDir,
    savedForLaterDirectory: false
  });
  const laterPlans = await discoverPlanDirectoryEntries({
    ...options,
    absoluteDir: path.join(absoluteDir, "later"),
    displayDir: path.join(displayDir, "later"),
    savedForLaterDirectory: true
  });

  return [...activePlans, ...laterPlans];
}

async function discoverPlanDirectoryEntries(options: {
  cwd: string;
  homeDir: string;
  fs: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  kind?: PlanKind;
  variables?: Record<string, string | undefined>;
  absoluteDir: string;
  displayDir: string;
  savedForLaterDirectory: boolean;
  archived?: boolean;
}): Promise<PlanEntry[]> {
  let entries: string[];
  try {
    entries = await options.fs.readdir(options.absoluteDir);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }

  const plans: PlanEntry[] = [];
  for (const name of entries) {
    if (!isSupportedPlanFile(name)) {
      continue;
    }

    const absolutePath = path.join(options.absoluteDir, name);
    const canonicalPath = await options.fs.realpath(absolutePath).catch((error: unknown) => {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    });
    if (canonicalPath === undefined) {
      continue;
    }
    if (canonicalPath !== path.resolve(absolutePath)) {
      throw new Error(
        `Plan file must not be a symbolic link: ${path.join(options.displayDir, name)}`
      );
    }
    const stat = await options.fs.stat(absolutePath).catch((error: unknown) => {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    });
    if (stat === undefined) {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }

    const displayPath = path.join(options.displayDir, name);
    const content = await options.fs.readFile(absolutePath, "utf8");
    let kind = classifyPlanKind(content, displayPath, options.archived);
    const savedForLater = options.savedForLaterDirectory
      ? (readSavedForLaterMetadata(content, displayPath) ?? {})
      : readSavedForLaterMetadata(content, displayPath);

    let metadata: Awaited<ReturnType<typeof readPlanMetadata>>;
    try {
      metadata = await readPlanMetadata({
        kind,
        absolutePath,
        path: displayPath,
        fs: options.fs,
        content
      });
    } catch (error) {
      if (!options.archived || kind === "plan") throw error;
      kind = "plan";
      metadata = await readPlanMetadata({
        kind,
        absolutePath,
        path: displayPath,
        fs: options.fs,
        content
      });
    }

    if (options.kind && kind !== options.kind) {
      continue;
    }

    plans.push({
      path: displayPath,
      absolutePath,
      kind,
      typeLabel: getPlanTypeLabel(kind),
      runner: getPlanRunner(kind),
      format: metadata.format,
      title: metadata.title,
      detail: metadata.detail,
      updatedAt: stat.mtimeMs,
      readiness: readPlanReadiness(content, displayPath),
      ...(savedForLater === undefined ? {} : { savedForLater })
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
  archived?: boolean;
  variables?: Record<string, string | undefined>;
}): Promise<PlanEntry[]> {
  const fs = options.fs ?? createDefaultFs();
  const results = await discoverSharedPlans({ ...options, fs });

  return results.sort((left, right) => {
    const leftSaved = isSavedForLaterPath(left.absolutePath) ? 1 : 0;
    const rightSaved = isSavedForLaterPath(right.absolutePath) ? 1 : 0;
    if (leftSaved !== rightSaved) {
      return leftSaved - rightSaved;
    }
    const readinessOrder = comparePlanReadiness(left, right);
    if (readinessOrder !== 0) return readinessOrder;
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.path.localeCompare(right.path);
  });
}
