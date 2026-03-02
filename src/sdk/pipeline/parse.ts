import { parse as parseYaml } from "yaml";
import type {
  PipelineDefinition,
  PipelineDefaults,
  PipelineStep,
  PipelineStepEntry
} from "./types.js";

const VALID_MODES = new Set(["yolo", "edit", "read"]);

export function parsePipeline(yamlContent: string): PipelineDefinition {
  const raw = parseYaml(yamlContent) as Record<string, unknown>;

  if (!raw || typeof raw !== "object") {
    throw new Error("Pipeline YAML must be a mapping");
  }

  const name = requireString(raw, "name", "Pipeline");
  const description = optionalString(raw, "description");
  const defaults = parseDefaults(raw.defaults);
  const steps = parseSteps(raw.steps);

  return {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(defaults !== undefined ? { defaults } : {}),
    steps
  };
}

function parseDefaults(raw: unknown): PipelineDefaults | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Pipeline defaults must be a mapping");
  }

  const obj = raw as Record<string, unknown>;
  const agent = optionalString(obj, "agent");
  const mode = optionalString(obj, "mode");
  const model = optionalString(obj, "model");

  if (mode !== undefined && !VALID_MODES.has(mode)) {
    throw new Error(
      `Invalid defaults mode "${mode}". Must be one of: ${[...VALID_MODES].join(", ")}`
    );
  }

  const result: PipelineDefaults = {};
  if (agent !== undefined) result.agent = agent;
  if (mode !== undefined) result.mode = mode as PipelineDefaults["mode"];
  if (model !== undefined) result.model = model;

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseSteps(raw: unknown): PipelineStepEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error("Pipeline steps must be an array");
  }

  if (raw.length === 0) {
    throw new Error("Pipeline steps must contain at least one step");
  }

  const seenNames = new Set<string>();
  const entries: PipelineStepEntry[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      throw new Error("Each step must be a mapping");
    }

    const obj = item as Record<string, unknown>;

    if ("parallel" in obj) {
      const group = parseParallelGroup(obj.parallel, seenNames);
      entries.push(group);
    } else {
      const step = parseStep(obj, seenNames);
      entries.push(step);
    }
  }

  return entries;
}

function parseParallelGroup(
  raw: unknown,
  seenNames: Set<string>
): { parallel: PipelineStep[] } {
  if (!Array.isArray(raw)) {
    throw new Error("Parallel group must be an array");
  }

  if (raw.length < 2) {
    throw new Error("Parallel group must contain at least 2 steps");
  }

  const steps: PipelineStep[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      throw new Error("Each parallel step must be a mapping");
    }
    steps.push(parseStep(item as Record<string, unknown>, seenNames));
  }

  return { parallel: steps };
}

function parseStep(
  obj: Record<string, unknown>,
  seenNames: Set<string>
): PipelineStep {
  const name = requireString(obj, "name", "Step");
  const prompt = requireString(obj, "prompt", `Step "${name}"`);

  if (seenNames.has(name)) {
    throw new Error(`Duplicate step name "${name}"`);
  }
  seenNames.add(name);

  const agent = optionalString(obj, "agent");
  const mode = optionalString(obj, "mode");
  const model = optionalString(obj, "model");
  const cwd = optionalString(obj, "cwd");
  const args = parseArgs(obj.args);

  if (mode !== undefined && !VALID_MODES.has(mode)) {
    throw new Error(
      `Invalid mode "${mode}" on step "${name}". Must be one of: ${[...VALID_MODES].join(", ")}`
    );
  }

  const step: PipelineStep = { name, prompt };
  if (agent !== undefined) step.agent = agent;
  if (mode !== undefined) step.mode = mode as PipelineStep["mode"];
  if (model !== undefined) step.model = model;
  if (args !== undefined) step.args = args;
  if (cwd !== undefined) step.cwd = cwd;

  return step;
}

function parseArgs(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    throw new Error("Step args must be an array");
  }

  return raw.map((item) => String(item));
}

function requireString(
  obj: Record<string, unknown>,
  field: string,
  context: string
): string {
  const value = obj[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} requires a non-empty "${field}" field`);
  }
  return value;
}

function optionalString(
  obj: Record<string, unknown>,
  field: string
): string | undefined {
  const value = obj[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`"${field}" must be a string`);
  }
  return value;
}
