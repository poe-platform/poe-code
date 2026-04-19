import path from "node:path";
import { resolve } from "@poe-code/config-extends";
import { parse, stringify } from "yaml";
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

function parseStepConfigSource(
  filePath: string,
  content: string
): { config: ResolvedStepsConfig; extendsBase: boolean } {
  const document = parseYamlDocument(filePath, content);

  return {
    config: parseStepConfigData(filePath, document),
    extendsBase: isRecord(document) && document.extends === true
  };
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

function encodeShallowStepsConfig(config: ResolvedStepsConfig): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (Object.keys(config.steps).length > 0) {
    data.steps = Object.fromEntries(
      Object.entries(config.steps).map(([stepName, definition]) => [
        stepName,
        JSON.stringify(definition)
      ])
    );
  }

  if (config.setup !== undefined) {
    data.setup = JSON.stringify(config.setup);
  }

  if (config.teardown !== undefined) {
    data.teardown = JSON.stringify(config.teardown);
  }

  return data;
}

function decodeShallowStepsConfig(
  filePath: string,
  document: Record<string, unknown>
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};

  if (document.steps !== undefined) {
    if (!isRecord(document.steps)) {
      throw new Error(`Invalid pipeline step config in "${filePath}": "steps" must be an object.`);
    }

    decoded.steps = Object.fromEntries(
      Object.entries(document.steps).map(([stepName, definition]) => [
        stepName,
        decodeEncodedDefinition(filePath, definition, `step "${stepName}"`)
      ])
    );
  }

  if (document.setup !== undefined) {
    decoded.setup = decodeEncodedDefinition(filePath, document.setup, "setup");
  }

  if (document.teardown !== undefined) {
    decoded.teardown = decodeEncodedDefinition(filePath, document.teardown, "teardown");
  }

  return decoded;
}

function decodeEncodedDefinition(
  filePath: string,
  value: unknown,
  context: string
): Record<string, unknown> {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${context} in "${filePath}": expected an object.`);
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${context} in "${filePath}": ${message}`);
  }

  if (!isRecord(decoded)) {
    throw new Error(`Invalid ${context} in "${filePath}": expected an object.`);
  }

  return decoded;
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
  fs: Pick<PipelineFileSystem, "readFile">;
}): Promise<ResolvedStepsConfig> {
  const globalDir = path.join(options.homeDir, ".poe-code", "pipeline");
  const globalPath = path.join(globalDir, "steps.yaml");
  const projectPath = path.join(options.cwd, ".poe-code", "pipeline", "steps.yaml");
  const [globalContent, projectContent] = await Promise.all([
    readOptionalFile(options.fs, globalPath),
    readOptionalFile(options.fs, projectPath)
  ]);
  const globalSource =
    globalContent == null ? undefined : parseStepConfigSource(globalPath, globalContent);

  if (projectContent == null) {
    return globalSource?.config ?? { steps: {} };
  }

  const projectSource = parseStepConfigSource(projectPath, projectContent);

  if (projectSource.extendsBase) {
    const resolved = await resolve(
      [
        { source: "document", filePath: projectPath, content: projectContent },
        { source: "base", path: globalDir }
      ],
      { fs: options.fs }
    );

    return parseStepConfigData(projectPath, resolved.data);
  }

  if (globalSource == null) {
    return projectSource.config;
  }

  const resolved = await resolve(
    [
      {
        source: "document",
        filePath: projectPath,
        content: stringify(encodeShallowStepsConfig(projectSource.config))
      },
      {
        source: "global",
        data: encodeShallowStepsConfig(globalSource.config)
      }
    ],
    { fs: options.fs }
  );

  return parseStepConfigData(projectPath, decodeShallowStepsConfig(projectPath, resolved.data));
}
