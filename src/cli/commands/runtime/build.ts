import path from "node:path";
import type { Command } from "commander";
import {
  createStateManager,
  parseRuntime,
  readMergedDocument,
  runtimeConfigScope,
  resolveScope,
  type E2bRuntime
} from "@poe-code/poe-code-config";
import { pathExists } from "@poe-code/config-mutations";
import { buildDockerRuntimeTemplate } from "@poe-code/process-runner";
import type { ExecutionState, Runner } from "@poe-code/process-runner";
import type { CliContainer } from "../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../shared.js";

export interface RuntimeBuildOptions {
  force?: boolean;
}

interface BuildE2bRuntimeTemplateResult {
  backend: "e2b";
  hash: string;
  templateId: string;
  cached: boolean;
}

type BuildE2bRuntimeTemplate = (input: {
  cwd: string;
  runtime: E2bRuntime;
  dockerfilePath: string;
  buildContext: string;
  state?: ExecutionState;
  runner?: Runner;
  force?: boolean;
}) => Promise<BuildE2bRuntimeTemplateResult>;

export function registerRuntimeBuildCommand(
  runtime: Command,
  root: Command,
  container: CliContainer
): void {
  runtime
    .command("build")
    .description("Build the configured runtime template.")
    .option("--force", "Ignore the local template cache and rebuild.")
    .action(async (options: RuntimeBuildOptions) => {
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
  const document = await readMergedDocument(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath
  );
  const runtimeScope = resolveScope(
    runtimeConfigScope.schema,
    document.runtime,
    container.env.variables
  );
  const runtimeConfig = parseRuntime(runtimeScope);

  resources.logger.intro("runtime build");

  if (runtimeConfig.type === "host") {
    resources.logger.info("Host runtime does not require a template build.");
    return;
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
  const buildE2bRuntimeTemplate = await loadE2bRuntimeTemplateBuilder();
  const result = await buildE2bRuntimeTemplate({
    cwd: container.env.cwd,
    runtime: runtimeConfig,
    dockerfilePath: paths.dockerfilePath,
    buildContext: paths.buildContext,
    state,
    force: options.force === true
  });
  resources.logger.success(
    result.cached
      ? `Using cached E2B template ${result.templateId}`
      : `Built E2B template ${result.templateId}`
  );
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
  return {
    dockerfilePath,
    buildContext: path.resolve(container.env.cwd, runtime.build_context ?? ".")
  };
}

async function loadE2bRuntimeTemplateBuilder(): Promise<BuildE2bRuntimeTemplate> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<unknown>;

  try {
    const module = await dynamicImport("@poe-code/runner-e2b");
    if (
      module &&
      typeof module === "object" &&
      "buildE2bRuntimeTemplate" in module &&
      typeof module.buildE2bRuntimeTemplate === "function"
    ) {
      return module.buildE2bRuntimeTemplate as BuildE2bRuntimeTemplate;
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
    "E2B runtime builds require @poe-code/runner-e2b to export buildE2bRuntimeTemplate."
  );
}

function isModuleNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND"
  );
}
