import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { discoverDocs } from "@poe-code/ralph";
import { readMergedDocument } from "@poe-code/poe-code-config";
import { readPlanMetadata } from "./format.js";
import type { DiscoveryFs, PlanEntry, PlanSource } from "./types.js";

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

function resolveAbsoluteDisplayPath(displayPath: string, cwd: string, homeDir: string): string {
  if (displayPath.startsWith("~/")) {
    return path.join(homeDir, displayPath.slice(2));
  }

  return path.isAbsolute(displayPath) ? displayPath : path.resolve(cwd, displayPath);
}

function isPipelinePlanFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("plan") && (lower.endsWith(".yaml") || lower.endsWith(".yml"));
}

function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

async function resolvePlanDirectorySetting(options: {
  fs: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  scope: "pipeline" | "experiment" | "ralph";
  envName: string;
  variables?: Record<string, string | undefined>;
}): Promise<string | undefined> {
  const envValue = options.variables?.[options.envName]?.trim();
  if (envValue) {
    return envValue;
  }

  const document = await readMergedDocument(
    options.fs as Parameters<typeof readMergedDocument>[0],
    options.configPath,
    options.projectConfigPath
  );
  const configured = document[options.scope]?.plan_directory;
  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim()
    : undefined;
}

async function scanDirectory(options: {
  fs: DiscoveryFs;
  absoluteDir: string;
  displayDir: string;
  source: PlanSource;
  include: (name: string) => boolean;
  cwd: string;
  homeDir: string;
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
    if (!options.include(name)) {
      continue;
    }

    const absolutePath = path.join(options.absoluteDir, name);
    const stat = await options.fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    const displayPath = path.join(options.displayDir, name);
    const metadata = await readPlanMetadata({
      source: options.source,
      absolutePath,
      path: displayPath,
      fs: options.fs
    });

    plans.push({
      path: displayPath,
      absolutePath: resolveAbsoluteDisplayPath(displayPath, options.cwd, options.homeDir),
      source: options.source,
      format: metadata.format,
      title: metadata.title,
      status: metadata.status,
      updatedAt: stat.mtimeMs
    });
  }

  return plans;
}

async function discoverPipelinePlans(options: {
  cwd: string;
  homeDir: string;
  fs: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  variables?: Record<string, string | undefined>;
}): Promise<PlanEntry[]> {
  const configuredDir = await resolvePlanDirectorySetting({
    fs: options.fs,
    configPath: options.configPath,
    projectConfigPath: options.projectConfigPath,
    scope: "pipeline",
    envName: "POE_PIPELINE_PLAN_DIRECTORY",
    variables: options.variables
  });

  const targets = configuredDir
    ? [{
        absoluteDir: resolveAbsoluteDirectory(configuredDir, options.cwd, options.homeDir),
        displayDir: configuredDir
      }]
    : [
        {
          absoluteDir: path.join(options.cwd, ".poe-code", "pipeline", "plans"),
          displayDir: ".poe-code/pipeline/plans"
        },
        {
          absoluteDir: path.join(options.homeDir, ".poe-code", "pipeline", "plans"),
          displayDir: "~/.poe-code/pipeline/plans"
        }
      ];

  const plans = await Promise.all(
    targets.map((target) =>
      scanDirectory({
        ...target,
        fs: options.fs,
        source: "pipeline",
        include: isPipelinePlanFile,
        cwd: options.cwd,
        homeDir: options.homeDir
      })
    )
  );

  return plans.flat();
}

async function discoverExperimentPlans(options: {
  cwd: string;
  homeDir: string;
  fs: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  variables?: Record<string, string | undefined>;
}): Promise<PlanEntry[]> {
  const configuredDir = await resolvePlanDirectorySetting({
    fs: options.fs,
    configPath: options.configPath,
    projectConfigPath: options.projectConfigPath,
    scope: "experiment",
    envName: "POE_EXPERIMENT_PLAN_DIRECTORY",
    variables: options.variables
  });

  const targets = configuredDir
    ? [{
        absoluteDir: resolveAbsoluteDirectory(configuredDir, options.cwd, options.homeDir),
        displayDir: configuredDir
      }]
    : [
        {
          absoluteDir: path.join(options.cwd, ".poe-code", "experiments"),
          displayDir: ".poe-code/experiments"
        },
        {
          absoluteDir: path.join(options.homeDir, ".poe-code", "experiments"),
          displayDir: "~/.poe-code/experiments"
        }
      ];

  const plans = await Promise.all(
    targets.map((target) =>
      scanDirectory({
        ...target,
        fs: options.fs,
        source: "experiment",
        include: isMarkdownFile,
        cwd: options.cwd,
        homeDir: options.homeDir
      })
    )
  );

  return plans.flat();
}

async function discoverRalphPlans(options: {
  cwd: string;
  homeDir: string;
  fs: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  variables?: Record<string, string | undefined>;
}): Promise<PlanEntry[]> {
  const configuredDir = await resolvePlanDirectorySetting({
    fs: options.fs,
    configPath: options.configPath,
    projectConfigPath: options.projectConfigPath,
    scope: "ralph",
    envName: "POE_RALPH_PLAN_DIRECTORY",
    variables: options.variables
  });

  const docs = await discoverDocs({
    cwd: options.cwd,
    homeDir: options.homeDir,
    planDirectory: configuredDir,
    fs: {
      readdir: options.fs.readdir,
      stat: async (filePath) => {
        const stat = await options.fs.stat(filePath);
        return {
          isFile: () => stat.isFile(),
          mtimeMs: stat.mtimeMs
        };
      }
    }
  });

  const plans = await Promise.all(
    docs.map(async (doc) => {
      const absolutePath = resolveAbsoluteDisplayPath(doc.path, options.cwd, options.homeDir);
      const stat = await options.fs.stat(absolutePath);
      const metadata = await readPlanMetadata({
        source: "ralph",
        absolutePath,
        path: doc.path,
        fs: options.fs
      });

      return {
        path: doc.path,
        absolutePath,
        source: "ralph" as const,
        format: metadata.format,
        title: metadata.title,
        status: metadata.status,
        updatedAt: stat.mtimeMs
      };
    })
  );

  return plans;
}

export async function discoverAllPlans(options: {
  cwd: string;
  homeDir: string;
  fs?: DiscoveryFs;
  configPath: string;
  projectConfigPath: string;
  source?: PlanSource;
  variables?: Record<string, string | undefined>;
}): Promise<PlanEntry[]> {
  const fs = options.fs ?? createDefaultFs();
  const discoverers: Record<PlanSource, () => Promise<PlanEntry[]>> = {
    pipeline: () => discoverPipelinePlans({ ...options, fs }),
    experiment: () => discoverExperimentPlans({ ...options, fs }),
    ralph: () => discoverRalphPlans({ ...options, fs })
  };

  const sources = options.source
    ? [options.source]
    : (Object.keys(discoverers) as PlanSource[]);

  const results = (await Promise.all(sources.map((source) => discoverers[source]()))).flat();
  const deduped = new Map<string, PlanEntry>();

  for (const result of results) {
    if (!deduped.has(result.absolutePath)) {
      deduped.set(result.absolutePath, result);
    }
  }

  return [...deduped.values()].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.path.localeCompare(right.path);
  });
}
