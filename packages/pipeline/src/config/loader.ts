import path from "node:path";
import { resolve } from "@poe-code/config-extends";
import { parse } from "yaml";
import type {
  PipelineConfig,
  PipelineFileSystem,
  ResolvedStepDefinitions,
  ResolvedStepsConfig,
  StepDefinition,
  StepMode
} from "../types.js";
import { isRecord, readOptionalFile } from "../utils.js";

function asStepMode(value: unknown): StepMode {
  if (value === undefined || value === null) {
    return "yolo";
  }
  if (value === "yolo" || value === "edit" || value === "read") {
    return value;
  }
  throw new Error(`Invalid step mode "${String(value)}". Expected "yolo", "edit", or "read".`);
}

function parseYamlDocument(filePath: string, content: string): unknown {
  try {
    return parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid pipeline step config YAML in "${filePath}": ${message}`);
  }
}

function parseStepConfigDocument(
  filePath: string,
  content: string
): ResolvedStepsConfig {
  const document = parseYamlDocument(filePath, content);
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
      ...(typeof value.model === "string" && value.model.length > 0 ? { model: value.model } : {})
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

  const planPath = document.planPath;
  if (planPath !== undefined && typeof planPath !== "string") {
    throw new Error(`Invalid planPath in "${filePath}": expected a string.`);
  }

  const config = { ...document } as PipelineConfig;
  delete config.extends;

  if (typeof planPath === "string" && planPath.trim().length > 0) {
    config.planPath = planPath.trim();
  } else {
    delete config.planPath;
  }

  return config;
}

async function loadStepsFile(
  fs: Pick<PipelineFileSystem, "readFile">,
  filePath: string
): Promise<ResolvedStepsConfig> {
  const content = await readOptionalFile(fs, filePath);
  if (content == null) {
    return { steps: {} };
  }
  return parseStepConfigDocument(filePath, content);
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

  const projectConfig = parseConfigDocument(projectPath, projectContent);

  const resolved = await resolve(
    [
      { source: "document", filePath: projectPath, content: projectContent },
      { source: "base", path: globalDir }
    ],
    { fs: options.fs, autoExtend: true }
  );

  const config = parseConfigData(projectPath, resolved.data);

  if (projectConfig.planPath !== undefined) {
    config.planPath = projectConfig.planPath;
  } else if (config.planPath === undefined && globalConfig?.planPath !== undefined && resolved.chain.length > 1) {
    config.planPath = globalConfig.planPath;
  }

  return config;
}

export async function loadResolvedSteps(options: {
  cwd: string;
  homeDir: string;
  fs: Pick<PipelineFileSystem, "readFile">;
}): Promise<ResolvedStepsConfig> {
  const globalPath = path.join(options.homeDir, ".poe-code", "pipeline", "steps.yaml");
  const projectPath = path.join(options.cwd, ".poe-code", "pipeline", "steps.yaml");
  const [globalConfig, projectConfig] = await Promise.all([
    loadStepsFile(options.fs, globalPath),
    loadStepsFile(options.fs, projectPath)
  ]);

  return {
    steps: { ...globalConfig.steps, ...projectConfig.steps },
    ...(projectConfig.setup ?? globalConfig.setup ? { setup: projectConfig.setup ?? globalConfig.setup } : {}),
    ...(projectConfig.teardown ?? globalConfig.teardown ? { teardown: projectConfig.teardown ?? globalConfig.teardown } : {})
  };
}
