import path from "node:path";
import * as fsPromises from "node:fs/promises";
import { discoverDocs } from "@poe-code/ralph";
import { readMergedDocument } from "@poe-code/poe-code-config";
import { readPlanMetadata } from "./format.js";
import type { DiscoveryFs, PlanEntry, PlanKind } from "./types.js";

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
  kind: PlanKind;
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
      kind: options.kind,
      absolutePath,
      path: displayPath,
      fs: options.fs
    });

    plans.push({
      path: displayPath,
      absolutePath: resolveAbsoluteDisplayPath(displayPath, options.cwd, options.homeDir),
      kind: options.kind,
      typeLabel: getPlanTypeLabel(options.kind),
      runner: getPlanRunner(options.kind),
      format: metadata.format,
      title: metadata.title,
      detail: metadata.detail,
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
        kind: "pipeline",
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
        kind: "experiment",
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
          isDirectory: () => stat.isDirectory?.() ?? false,
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
        kind: "ralph",
        absolutePath,
        path: doc.path,
        fs: options.fs
      });

      return {
        path: doc.path,
        absolutePath,
        kind: "ralph" as const,
        typeLabel: getPlanTypeLabel("ralph"),
        runner: getPlanRunner("ralph"),
        format: metadata.format,
        title: metadata.title,
        detail: metadata.detail,
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
  kind?: PlanKind;
  variables?: Record<string, string | undefined>;
}): Promise<PlanEntry[]> {
  const fs = options.fs ?? createDefaultFs();
  const discoverers = {
    pipeline: () => discoverPipelinePlans({ ...options, fs }),
    experiment: () => discoverExperimentPlans({ ...options, fs }),
    ralph: () => discoverRalphPlans({ ...options, fs })
  };
  type DiscoverablePlanKind = keyof typeof discoverers;

  const kinds = options.kind
    ? [options.kind]
    : (Object.keys(discoverers) as DiscoverablePlanKind[]);

  const results = (
    await Promise.all(
      kinds.map(async (kind) => {
        const discover = discoverers[kind as DiscoverablePlanKind];
        return discover ? discover() : [];
      })
    )
  ).flat();
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
