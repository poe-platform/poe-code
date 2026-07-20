import path from "node:path";
import { resolve } from "@poe-code/config-extends";
import { parse } from "yaml";
import {
  PIPELINE_STEP_MODES,
  type PipelineConfig,
  type PipelineFileSystem,
  type ResolvedStepDefinitions,
  type ResolvedStepsConfig,
  type StepDefinition,
  type StepDefinitionOverride,
  type StepDefinitionOverrides,
  type StepHooks,
  type StepMode
} from "../types.js";
import { defineRecordEntry, isNotFound, isRecord, readOptionalFile } from "../utils.js";

async function assertManagedPathSafe(
  fs: Pick<PipelineFileSystem, "lstat">,
  rootPath: string,
  targetPath: string
): Promise<void> {
  const relativePath = path.relative(rootPath, targetPath);
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing pipeline configuration outside managed root: ${targetPath}`);
  }

  let currentPath = rootPath;
  for (const segment of relativePath.split(path.sep)) {
    if (segment.length === 0) {
      continue;
    }
    currentPath = path.join(currentPath, segment);
    try {
      if ((await fs.lstat(currentPath)).isSymbolicLink()) {
        throw new Error(`Refusing pipeline configuration through symbolic link: ${currentPath}`);
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }
}

function resolveNamedStepConfigName(name: string | undefined): string {
  const trimmed = name?.trim() || "default";
  if (
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    path.isAbsolute(trimmed)
  ) {
    throw new Error(`Invalid pipeline step config name "${trimmed}".`);
  }
  return trimmed;
}

function asStepMode(value: unknown): StepMode | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (PIPELINE_STEP_MODES.includes(value as StepMode)) {
    return value as StepMode;
  }
  throw new Error(
    `Invalid step mode "${String(value)}". Expected "yolo", "auto", "edit", or "read".`
  );
}

function isSkillReference(value: string): boolean {
  const slashIndex = value.indexOf("/");
  return (
    value.length > 0 &&
    value === value.trim() &&
    (slashIndex === -1 ||
      (slashIndex > 0 &&
        slashIndex < value.length - 1 &&
        value.indexOf("/", slashIndex + 1) === -1))
  );
}

function parseSkills(value: unknown, context: string, filePath: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((skill) => typeof skill === "string")) {
    throw new Error(
      `Invalid skills for ${context} in "${filePath}": expected an array of strings.`
    );
  }
  if (!value.every(isSkillReference)) {
    throw new Error(`Invalid skills for ${context} in "${filePath}": expected skill references.`);
  }
  return value;
}

function parseHooks(value: unknown, context: string, filePath: string): StepHooks | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid hooks for ${context} in "${filePath}": expected an object.`);
  }
  const from = getOwnEntry(value, "from");
  if (typeof from !== "string" || from.length === 0) {
    throw new Error(
      `Invalid hooks from for ${context} in "${filePath}": expected a non-empty string.`
    );
  }
  const strategy = getOwnEntry(value, "strategy");
  if (
    strategy !== undefined &&
    strategy !== "auto" &&
    strategy !== "symlink" &&
    strategy !== "transform"
  ) {
    throw new Error(
      `Invalid hooks strategy for ${context} in "${filePath}": expected "auto", "symlink", or "transform".`
    );
  }
  const scope = getOwnEntry(value, "scope");
  if (
    scope !== undefined &&
    scope !== "project" &&
    scope !== "user" &&
    scope !== "merged"
  ) {
    throw new Error(
      `Invalid hooks scope for ${context} in "${filePath}": expected "project", "user", or "merged".`
    );
  }
  return {
    from,
    ...(strategy !== undefined ? { strategy } : {}),
    ...(scope !== undefined ? { scope } : {})
  };
}

function parseYamlDocument(filePath: string, content: string): unknown {
  try {
    return parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid pipeline step config YAML in "${filePath}": ${message}`);
  }
}

function parseStepConfigData(filePath: string, document: unknown): ResolvedStepsConfig {
  if (document === null || document === undefined) {
    return { steps: {} };
  }
  if (!isRecord(document)) {
    throw new Error(`Invalid pipeline step config in "${filePath}": expected a top-level object.`);
  }

  function parseDef(value: unknown, context: string): StepDefinition {
    if (!isRecord(value)) {
      throw new Error(`Invalid ${context} in "${filePath}": expected an object.`);
    }
    const prompt = getOwnEntry(value, "prompt");
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new Error(`Missing prompt for ${context} in "${filePath}".`);
    }
    const agent = getOwnEntry(value, "agent");
    const model = getOwnEntry(value, "model");
    const skills = getOwnEntry(value, "skills");
    const hooks = getOwnEntry(value, "hooks");
    const mode = asStepMode(getOwnEntry(value, "mode"));
    return {
      prompt,
      ...(mode ? { mode } : {}),
      ...(typeof agent === "string" && agent.length > 0 ? { agent } : {}),
      ...(typeof model === "string" && model.length > 0 ? { model } : {}),
      ...(skills !== undefined ? { skills: parseSkills(skills, context, filePath) } : {}),
      ...(hooks !== undefined ? { hooks: parseHooks(hooks, context, filePath) } : {})
    };
  }

  const stepsValue = getOwnEntry(document, "steps");
  const steps: ResolvedStepDefinitions = {};
  if (stepsValue !== undefined && stepsValue !== null) {
    if (!isRecord(stepsValue)) {
      throw new Error(`Invalid pipeline step config in "${filePath}": "steps" must be an object.`);
    }
    for (const [stepName, value] of Object.entries(stepsValue)) {
      defineRecordEntry(steps, stepName, parseDef(value, `step "${stepName}"`));
    }
  }

  const result: ResolvedStepsConfig = { steps };
  const setup = getOwnEntry(document, "setup");
  if (setup !== undefined && setup !== null) {
    result.setup = parseDef(setup, "setup");
  }
  const teardown = getOwnEntry(document, "teardown");
  if (teardown !== undefined && teardown !== null) {
    result.teardown = parseDef(teardown, "teardown");
  }

  return result;
}

function mergeStepDefinition(
  base: StepDefinition | undefined,
  override: StepDefinitionOverride,
  context: string
): StepDefinition {
  const baseRecord = base as Record<string, unknown> | undefined;
  const overrideRecord = override as Record<string, unknown>;
  const prompt = getOwnEntry(overrideRecord, "prompt") ?? getOwnOptionalEntry(baseRecord, "prompt");
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error(`Missing prompt for ${context}.`);
  }

  const agent = getOwnEntry(overrideRecord, "agent") ?? getOwnOptionalEntry(baseRecord, "agent");
  const model = getOwnEntry(overrideRecord, "model") ?? getOwnOptionalEntry(baseRecord, "model");
  const skills = getOwnEntry(overrideRecord, "skills") ?? getOwnOptionalEntry(baseRecord, "skills");
  const hooks = getOwnEntry(overrideRecord, "hooks") ?? getOwnOptionalEntry(baseRecord, "hooks");
  const mode =
    (getOwnEntry(overrideRecord, "mode") as StepMode | undefined) ??
    (getOwnOptionalEntry(baseRecord, "mode") as StepMode | undefined);

  return {
    prompt,
    ...(mode ? { mode } : {}),
    ...(typeof agent === "string" && agent.length > 0 ? { agent } : {}),
    ...(typeof model === "string" && model.length > 0 ? { model } : {}),
    ...(skills ? { skills: skills as string[] } : {}),
    ...(hooks ? { hooks: hooks as StepHooks } : {})
  };
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function getOwnOptionalEntry(
  record: Record<string, unknown> | undefined,
  key: string
): unknown {
  return record === undefined ? undefined : getOwnEntry(record, key);
}

function applyStepOverrides(
  config: ResolvedStepsConfig,
  stepOverrides: StepDefinitionOverrides | undefined
): ResolvedStepsConfig {
  if (!stepOverrides || Object.keys(stepOverrides).length === 0) {
    return config;
  }

  const steps: ResolvedStepDefinitions = { ...config.steps };

  for (const [stepName, override] of Object.entries(stepOverrides)) {
    defineRecordEntry(
      steps,
      stepName,
      mergeStepDefinition(steps[stepName], override, `plan step "${stepName}"`)
    );
  }

  return {
    ...config,
    steps
  };
}

async function fileExists(
  fs: Pick<PipelineFileSystem, "stat">,
  targetPath: string
): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isFile();
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function directoryExists(
  fs: Pick<PipelineFileSystem, "stat">,
  targetPath: string
): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isDirectory();
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function resolveStepsFile(options: {
  cwd: string;
  homeDir: string;
  fs: Pick<PipelineFileSystem, "stat" | "lstat">;
}): Promise<string | null> {
  const projectFile = path.join(options.cwd, ".poe-code", "pipeline", "steps.yaml");
  await assertManagedPathSafe(options.fs, options.cwd, projectFile);
  if (await fileExists(options.fs, projectFile)) {
    return projectFile;
  }

  const globalFile = path.join(options.homeDir, ".poe-code", "pipeline", "steps.yaml");
  await assertManagedPathSafe(options.fs, options.homeDir, globalFile);
  if (await fileExists(options.fs, globalFile)) {
    return globalFile;
  }

  return null;
}

async function resolveStepsDirectory(options: {
  cwd: string;
  homeDir: string;
  fs: Pick<PipelineFileSystem, "stat" | "lstat">;
}): Promise<string | null> {
  const projectDir = path.join(options.cwd, ".poe-code", "pipeline", "steps");
  await assertManagedPathSafe(options.fs, options.cwd, projectDir);
  if (await directoryExists(options.fs, projectDir)) {
    return projectDir;
  }

  const globalDir = path.join(options.homeDir, ".poe-code", "pipeline", "steps");
  await assertManagedPathSafe(options.fs, options.homeDir, globalDir);
  if (await directoryExists(options.fs, globalDir)) {
    return globalDir;
  }

  return null;
}

function parseConfigDocument(filePath: string, content: string): PipelineConfig {
  return parseConfigData(filePath, parseYamlDocument(filePath, content));
}

function parseConfigData(filePath: string, document: unknown): PipelineConfig {
  if (document === null || document === undefined) {
    return {};
  }
  if (!isRecord(document)) {
    throw new Error(`Invalid pipeline config in "${filePath}": expected a top-level object.`);
  }

  const config = { ...document } as PipelineConfig;
  delete config.extends;

  const planDirectory = Object.prototype.hasOwnProperty.call(config, "plan_directory")
    ? config.plan_directory
    : undefined;
  if (planDirectory !== undefined && typeof planDirectory !== "string") {
    throw new Error(`Invalid pipeline config in "${filePath}": "plan_directory" must be a string.`);
  }

  return config;
}

export async function loadPipelineConfig(options: {
  cwd: string;
  homeDir: string;
  fs: Pick<PipelineFileSystem, "readFile" | "lstat">;
}): Promise<PipelineConfig> {
  const globalDir = path.join(options.homeDir, ".poe-code", "pipeline");
  const globalPath = path.join(globalDir, "config.yaml");
  const projectPath = path.join(options.cwd, ".poe-code", "pipeline", "config.yaml");
  await Promise.all([
    assertManagedPathSafe(options.fs, options.homeDir, globalPath),
    assertManagedPathSafe(options.fs, options.cwd, projectPath)
  ]);
  const [globalContent, projectContent] = await Promise.all([
    readOptionalFile(options.fs, globalPath),
    readOptionalFile(options.fs, projectPath)
  ]);

  const globalConfig =
    globalContent == null ? undefined : parseConfigDocument(globalPath, globalContent);

  if (projectContent == null) {
    return globalConfig ?? {};
  }

  const resolved = await resolve(
    [
      { source: "document", filePath: projectPath, content: projectContent },
      { source: "base", path: globalDir }
    ],
    { fs: options.fs, autoExtend: true }
  );

  return parseConfigData(projectPath, resolved.data);
}

export async function loadResolvedSteps(options: {
  cwd: string;
  homeDir: string;
  fs: Pick<PipelineFileSystem, "readFile" | "stat" | "lstat">;
  name?: string;
  stepOverrides?: StepDefinitionOverrides;
}): Promise<ResolvedStepsConfig> {
  const name = resolveNamedStepConfigName(options.name);

  const stepsFile = await resolveStepsFile(options);
  if (stepsFile) {
    const content = await readOptionalFile(options.fs, stepsFile);
    if (content != null) {
      return applyStepOverrides(
        parseStepConfigData(stepsFile, parseYamlDocument(stepsFile, content)),
        options.stepOverrides
      );
    }
  }

  const stepsDir = await resolveStepsDirectory(options);

  if (!stepsDir) {
    if (name !== "default") {
      throw new Error(`Unknown pipeline step config "${name}": no pipeline steps directory found.`);
    }
    return applyStepOverrides({ steps: {} }, options.stepOverrides);
  }

  const filePath = path.join(stepsDir, `${name}.yaml`);
  const content = await readOptionalFile(options.fs, filePath);

  if (content == null) {
    throw new Error(`Unknown pipeline step config "${name}" in "${stepsDir}".`);
  }

  return applyStepOverrides(
    parseStepConfigData(filePath, parseYamlDocument(filePath, content)),
    options.stepOverrides
  );
}
