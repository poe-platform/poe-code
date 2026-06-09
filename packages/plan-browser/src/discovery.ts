import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { planConfigScope, readMergedDocumentReadonly, resolveScope } from "@poe-code/poe-code-config";
import { hasOwnErrorCode } from "./error-codes.js";
import { readPlanMetadata, splitFrontmatter } from "./format.js";
import type { DiscoveryFs, PlanEntry, PlanKind } from "./types.js";

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

function classifyPlanKind(content: string, filePath: string): PlanKind {
  const { data } = splitFrontmatter(content, filePath);

  if (data === undefined) {
    return "plan";
  }

  if (data.kind === undefined) {
    throw new Error(`${filePath}: missing required frontmatter kind`);
  }

  return toPlanKind(data.kind, filePath);
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
    const canonicalPath = await options.fs.realpath(absolutePath);
    if (canonicalPath !== path.resolve(absolutePath)) {
      throw new Error(`Plan file must not be a symbolic link: ${path.join(displayDir, name)}`);
    }
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
      fs: options.fs,
      content
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
