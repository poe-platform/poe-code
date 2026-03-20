import path from "node:path";
import { parse } from "yaml";
import type {
  PipelineConfig,
  PipelineFileSystem,
  ResolvedStepDefinitions,
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
): ResolvedStepDefinitions {
  const document = parseYamlDocument(filePath, content);
  if (!isRecord(document)) {
    throw new Error(`Invalid pipeline step config in "${filePath}": expected a top-level object.`);
  }

  const stepsValue = document.steps;
  if (stepsValue === undefined || stepsValue === null) {
    return {};
  }
  if (!isRecord(stepsValue)) {
    throw new Error(`Invalid pipeline step config in "${filePath}": "steps" must be an object.`);
  }

  const steps: ResolvedStepDefinitions = {};
  for (const [stepName, value] of Object.entries(stepsValue)) {
    if (!isRecord(value)) {
      throw new Error(`Invalid step "${stepName}" in "${filePath}": expected an object.`);
    }

    const instruction = value.instruction;
    if (typeof instruction !== "string" || instruction.length === 0) {
      throw new Error(`Missing instruction for step "${stepName}" in "${filePath}".`);
    }

    const step: StepDefinition = {
      mode: asStepMode(value.mode),
      instruction,
      ...(typeof value.agent === "string" && value.agent.length > 0
        ? { agent: value.agent }
        : {}),
      ...(typeof value.model === "string" && value.model.length > 0
        ? { model: value.model }
        : {})
    };
    steps[stepName] = step;
  }

  return steps;
}

function parseConfigDocument(filePath: string, content: string): PipelineConfig {
  const document = parseYamlDocument(filePath, content);
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

  return {
    ...(typeof planPath === "string" && planPath.trim().length > 0
      ? { planPath: planPath.trim() }
      : {})
  };
}

async function loadConfigFile(
  fs: Pick<PipelineFileSystem, "readFile">,
  filePath: string
): Promise<PipelineConfig> {
  const content = await readOptionalFile(fs, filePath);
  if (content == null) {
    return {};
  }
  return parseConfigDocument(filePath, content);
}

async function loadStepsFile(
  fs: Pick<PipelineFileSystem, "readFile">,
  filePath: string
): Promise<ResolvedStepDefinitions> {
  const content = await readOptionalFile(fs, filePath);
  if (content == null) {
    return {};
  }
  return parseStepConfigDocument(filePath, content);
}

export async function loadPipelineConfig(options: {
  cwd: string;
  homeDir: string;
  fs: Pick<PipelineFileSystem, "readFile">;
}): Promise<PipelineConfig> {
  const globalPath = path.join(options.homeDir, ".poe-code", "pipeline", "config.yaml");
  const projectPath = path.join(options.cwd, ".poe-code", "pipeline", "config.yaml");
  const [globalConfig, projectConfig] = await Promise.all([
    loadConfigFile(options.fs, globalPath),
    loadConfigFile(options.fs, projectPath)
  ]);

  return {
    ...globalConfig,
    ...projectConfig
  };
}

export async function loadResolvedSteps(options: {
  cwd: string;
  homeDir: string;
  fs: Pick<PipelineFileSystem, "readFile">;
}): Promise<ResolvedStepDefinitions> {
  const globalPath = path.join(options.homeDir, ".poe-code", "pipeline", "steps.yaml");
  const projectPath = path.join(options.cwd, ".poe-code", "pipeline", "steps.yaml");
  const [globalSteps, projectSteps] = await Promise.all([
    loadStepsFile(options.fs, globalPath),
    loadStepsFile(options.fs, projectPath)
  ]);

  return {
    ...globalSteps,
    ...projectSteps
  };
}
