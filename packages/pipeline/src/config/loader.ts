import path from "node:path";
import { resolve } from "@poe-code/config-extends";
import { parse } from "yaml";
import type {
  PipelineConfig,
  PipelineFileSystem,
  ResolvedStepDefinitions,
  ResolvedStepsConfig,
  StepDefinition,
  StepDefinitionOverride,
  StepDefinitionOverrides,
  StepMode
} from "../types.js";
import { isNotFound, isRecord, readOptionalFile } from "../utils.js";

function asStepMode(value: unknown): StepMode {
  if (value === undefined || value === null) {
    return "yolo";
  }
  if (value === "yolo" || value === "edit" || value === "read") {
    return value;
  }
  throw new Error(`Invalid step mode "${String(value)}". Expected "yolo", "edit", or "read".`);
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
    throw new Error(`Invalid skills for ${context} in "${filePath}": expected an array of strings.`);
  }
  if (!value.every(isSkillReference)) {
    throw new Error(`Invalid skills for ${context} in "${filePath}": expected skill references.`);
  }
  return value;
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
    const prompt = value.prompt;
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new Error(`Missing prompt for ${context} in "${filePath}".`);
    }
    return {
      mode: asStepMode(value.mode),
      prompt,
      ...(typeof value.agent === "string" && value.agent.length > 0 ? { agent: value.agent } : {}),
      ...(typeof value.model === "string" && value.model.length > 0 ? { model: value.model } : {}),
      ...(value.skills !== undefined ? { skills: parseSkills(value.skills, context, filePath) } : {})
    };
  }

  const stepsValue = document.steps;
  const steps: ResolvedStepDefinitions = {};
  if (stepsValue !== undefined && stepsValue !== null) {
    if (!isRecord(stepsValue)) {
      throw new Error(`Invalid pipeline step config in "${filePath}": "steps" must be an object.`);
    }
    for (const [stepName, value] of Object.entries(stepsValue)) {
      steps[stepName] = parseDef(value, `step "${stepName}"`);
    }
  }

  const result: ResolvedStepsConfig = { steps };
  if (document.setup !== undefined && document.setup !== null) {
    result.setup = parseDef(document.setup, "setup");
  }
  if (document.teardown !== undefined && document.teardown !== null) {
    result.teardown = parseDef(document.teardown, "teardown");
  }

  return result;
}

function mergeStepDefinition(
  base: StepDefinition | undefined,
  override: StepDefinitionOverride,
  context: string
): StepDefinition {
  const prompt = override.prompt ?? base?.prompt;
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error(`Missing prompt for ${context}.`);
  }

  const agent = override.agent ?? base?.agent;
  const model = override.model ?? base?.model;
  const skills = override.skills ?? base?.skills;

  return {
    mode: override.mode ?? base?.mode ?? "yolo",
    prompt,
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(skills ? { skills } : {})
  };
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
    steps[stepName] = mergeStepDefinition(steps[stepName], override, `plan step "${stepName}"`);
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
  fs: Pick<PipelineFileSystem, "stat">;
}): Promise<string | null> {
  const projectFile = path.join(options.cwd, ".poe-code", "pipeline", "steps.yaml");
  if (await fileExists(options.fs, projectFile)) {
    return projectFile;
  }

  const globalFile = path.join(options.homeDir, ".poe-code", "pipeline", "steps.yaml");
  if (await fileExists(options.fs, globalFile)) {
    return globalFile;
  }

  return null;
}

async function resolveStepsDirectory(options: {
  cwd: string;
  homeDir: string;
  fs: Pick<PipelineFileSystem, "stat">;
}): Promise<string | null> {
  const projectDir = path.join(options.cwd, ".poe-code", "pipeline", "steps");
  if (await directoryExists(options.fs, projectDir)) {
    return projectDir;
  }

  const globalDir = path.join(options.homeDir, ".poe-code", "pipeline", "steps");
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

  if (config.plan_directory !== undefined && typeof config.plan_directory !== "string") {
    throw new Error(`Invalid pipeline config in "${filePath}": "plan_directory" must be a string.`);
  }

  return config;
}

export async function loadPipelineConfig(options: {
  cwd: string;
  homeDir: string;
  fs: Pick<PipelineFileSystem, "readFile">;
}): Promise<PipelineConfig> {
  const globalDir = path.join(options.homeDir, ".poe-code", "pipeline");
  const globalPath = path.join(globalDir, "config.yaml");
  const projectPath = path.join(options.cwd, ".poe-code", "pipeline", "config.yaml");
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
  fs: Pick<PipelineFileSystem, "readFile" | "stat">;
  name?: string;
  stepOverrides?: StepDefinitionOverrides;
}): Promise<ResolvedStepsConfig> {
  const name = options.name?.trim() || "default";

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
