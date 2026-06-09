import path from "node:path";
import type { Command } from "commander";
import {
  createStateManager,
  parseRuntime,
  readMergedDocument,
  readMergedDocumentReadonly,
  runtimeConfigScope,
  resolveScope,
  type E2bRuntime
} from "@poe-code/poe-code-config";
import { pathExists } from "@poe-code/config-mutations";
import { buildDockerRuntimeTemplate } from "@poe-code/process-runner";
import type { ExecutionState } from "@poe-code/process-runner";
import { withSpinner } from "toolcraft-design";
import type { CliContainer } from "../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../shared.js";
import { addRuntimeOptions, pickRuntimeOptions, type RuntimeCliOptions } from "../runtime-options.js";
import { ValidationError } from "../../errors.js";
import { hasOwnErrorCode } from "../../../utils/error-codes.js";

interface BuildLogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: Date;
}

export interface RuntimeBuildOptions extends RuntimeCliOptions {
  force?: boolean;
}

interface BuildE2bRuntimeTemplateResult {
  backend: "e2b";
  hash: string;
  templateId: string;
  cached: boolean;
}

interface E2bRunnerModule {
  buildE2bRuntimeTemplate: (input: {
    runtime: E2bRuntime;
    dockerfilePath: string;
    buildContext: string;
    state?: ExecutionState;
    apiKey: string;
    force?: boolean;
    onLog?: (entry: BuildLogEntry) => void;
  }) => Promise<BuildE2bRuntimeTemplateResult>;
  resolveE2bApiKey: (input: { cwd: string }) => Promise<string>;
}

export function registerRuntimeBuildCommand(
  runtime: Command,
  root: Command,
  container: CliContainer
): void {
  const cmd = runtime
    .command("build")
    .description("Build the configured runtime template.")
    .option("--force", "Ignore the local template cache and rebuild.");
  addRuntimeOptions(cmd).action(async (options: RuntimeBuildOptions) => {
    await executeRuntimeBuild(root, container, options);
  });
}

async function executeRuntimeBuild(
  program: Command,
  container: CliContainer,
  options: RuntimeBuildOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "runtime:build");
  const state = createStateManager(
    container.env.homeDir,
    container.fs as unknown as Parameters<typeof createStateManager>[1]
  );
  const readConfigDocument = flags.dryRun ? readMergedDocumentReadonly : readMergedDocument;
  const document = await readConfigDocument(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const runtimeScope = resolveScope(
    runtimeConfigScope.schema,
    document.runtime,
    container.env.variables
  );
  const runtimeOverrides = pickRuntimeOptions(options);
  const runtimeConfig = parseRuntime({
    ...runtimeScope,
    ...(runtimeOverrides.runtime !== undefined ? { type: runtimeOverrides.runtime } : {}),
    ...(runtimeOverrides.runtimeImage !== undefined ? { image: runtimeOverrides.runtimeImage } : {}),
    ...(runtimeOverrides.runtimeTemplate !== undefined
      ? { template_id: runtimeOverrides.runtimeTemplate }
      : {})
  });

  resources.logger.intro("runtime build");

  if (runtimeConfig.type === "host") {
    throw new ValidationError(
      "Host runtime has no template to build. " +
        "Pass --runtime e2b or --runtime docker, " +
        'or set "runtime": { "type": "..." } in .poe-code/config.json.'
    );
  }

  if (runtimeConfig.type === "docker") {
    if (runtimeConfig.image !== undefined) {
      resources.logger.info(`Docker runtime uses pinned image ${runtimeConfig.image}.`);
      return;
    }
    if (flags.dryRun) {
      resources.logger.dryRun("Dry run: would build docker runtime template.");
      return;
    }
    await requireRuntimeBuildPaths(container, runtimeConfig, "Docker");
    const result = await buildDockerRuntimeTemplate({
      cwd: container.env.cwd,
      runtime: runtimeConfig,
      state,
      force: options.force === true
    });
    resources.logger.success(
      result.cached
        ? `Using cached Docker image ${result.image}`
        : `Built Docker image ${result.image}`
    );
    return;
  }

  if (runtimeConfig.template_id !== undefined) {
    resources.logger.info(`E2B runtime uses pinned template ${runtimeConfig.template_id}.`);
    return;
  }
  if (flags.dryRun) {
    resources.logger.dryRun("Dry run: would build e2b runtime template.");
    return;
  }
  const paths = await requireRuntimeBuildPaths(container, runtimeConfig, "E2B");
  const e2bModule = await loadE2bRunnerModule();
  const apiKey = await e2bModule.resolveE2bApiKey({ cwd: container.env.cwd });
  await withSpinner({
    message: "Building E2B template",
    fn: () =>
      e2bModule.buildE2bRuntimeTemplate({
        runtime: runtimeConfig,
        dockerfilePath: paths.dockerfilePath,
        buildContext: paths.buildContext,
        state,
        apiKey,
        force: options.force === true,
        onLog: (entry) => {
          if (entry.level === "warn" || entry.level === "error") {
            resources.logger.info(`[${entry.level}] ${entry.message}`);
          }
        }
      }),
    stopMessage: (r) =>
      r.cached
        ? `Using cached E2B template ${r.templateId}`
        : `Built E2B template ${r.templateId}`
  });
}

async function requireRuntimeBuildPaths(
  container: CliContainer,
  runtime: { dockerfile?: string; build_context?: string },
  label: string
): Promise<{ dockerfilePath: string; buildContext: string }> {
  const dockerfilePath = path.resolve(
    container.env.cwd,
    runtime.dockerfile ?? path.join(".poe-code", "Dockerfile")
  );
  if (!(await pathExists(container.fs, dockerfilePath))) {
    throw new Error(`${label} runtime requires a Dockerfile at ${dockerfilePath}.`);
  }
  const buildContext = path.resolve(container.env.cwd, runtime.build_context ?? ".");
  const canonicalCwd = await container.fs.realpath(container.env.cwd);
  const canonicalDockerfilePath = await container.fs.realpath(dockerfilePath);
  const canonicalBuildContext = await container.fs.realpath(buildContext);
  assertRuntimePathInsideCwd(canonicalCwd, canonicalDockerfilePath, "runtime.dockerfile");
  assertRuntimePathInsideCwd(canonicalCwd, canonicalBuildContext, "runtime.build_context");

  return {
    dockerfilePath: canonicalDockerfilePath,
    buildContext: canonicalBuildContext
  };
}

function assertRuntimePathInsideCwd(cwd: string, targetPath: string, fieldName: string): void {
  if (!isPathInsideOrEqual(cwd, targetPath)) {
    throw new Error(`${fieldName} must remain inside runtime cwd ${cwd}.`);
  }
}

function isPathInsideOrEqual(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function loadE2bRunnerModule(): Promise<E2bRunnerModule> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<unknown>;

  try {
    const module = await dynamicImport("@poe-code/runner-e2b");
    if (
      module &&
      typeof module === "object" &&
      "buildE2bRuntimeTemplate" in module &&
      typeof module.buildE2bRuntimeTemplate === "function" &&
      "resolveE2bApiKey" in module &&
      typeof module.resolveE2bApiKey === "function"
    ) {
      return module as unknown as E2bRunnerModule;
    }
  } catch (error) {
    if (isModuleNotFound(error)) {
      throw new Error(
        "E2B runtime builds require @poe-code/runner-e2b. The E2B runner package is not installed in this checkout."
      );
    }
    throw error;
  }

  throw new Error(
    "E2B runtime builds require @poe-code/runner-e2b to export buildE2bRuntimeTemplate and resolveE2bApiKey."
  );
}

function isModuleNotFound(error: unknown): boolean {
  return hasOwnErrorCode(error, "ERR_MODULE_NOT_FOUND");
}
