import path from "node:path";
import type { Command } from "commander";
import {
  createStateManager,
  parseRuntime,
  readMergedDocument,
  readMergedDocumentReadonly,
  runtimeConfigScope,
  resolveScope
} from "@poe-code/poe-code-config/core";
import { pathExists } from "@poe-code/config-mutations";
import { buildDockerRuntimeTemplate } from "@poe-code/process-runner";
import type { CliContainer } from "../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../shared.js";
import { addRuntimeOptions, pickRuntimeOptions, type RuntimeCliOptions } from "../runtime-options.js";
import { ValidationError } from "../../errors.js";

export interface RuntimeBuildOptions extends RuntimeCliOptions {
  force?: boolean;
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
    ...(runtimeOverrides.runtimeImage !== undefined ? { image: runtimeOverrides.runtimeImage } : {})
  });

  resources.logger.intro("runtime build");

  if (runtimeConfig.type === "host") {
    throw new ValidationError(
      "Host runtime has no template to build. " +
        "Pass --runtime docker, " +
        'or set "runtime": { "type": "..." } in .poe-code/config.json.'
    );
  }

  if (runtimeConfig.image !== undefined) {
    resources.logger.info(`Docker runtime uses pinned image ${runtimeConfig.image}.`);
    return;
  }
  await requireRuntimeBuildPaths(container, runtimeConfig, "Docker");
  if (flags.dryRun) {
    resources.logger.dryRun("Dry run: would build docker runtime template.");
    return;
  }
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
