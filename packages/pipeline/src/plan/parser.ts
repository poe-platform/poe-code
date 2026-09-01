import { parse } from "yaml";
import {
  PIPELINE_STEP_MODES,
  type McpSpawnConfig,
  type McpSpawnServer,
  type PipelinePlan,
  type PipelineStatus,
  type PipelineTask,
  type ResolvedStepDefinitions,
  type StepDefinition,
  type StepDefinitionOverride,
  type StepDefinitionOverrides,
  type StepHooks,
  type StepMode
} from "../types.js";
import { defineRecordEntry, isRecord } from "../utils.js";

type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";

type JsonSchema = {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: JsonSchemaType | readonly JsonSchemaType[];
  const?: unknown;
  default?: unknown;
  enum?: readonly unknown[];
  minimum?: number;
  minLength?: number;
  minItems?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  anyOf?: readonly JsonSchema[];
};

export const pipelineDocumentSchemaId =
  "https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json";

const pipelineStatusSchema: JsonSchema = {
  type: "string",
  enum: ["open", "done", "failed"]
};

const stepHooksSchema: JsonSchema = {
  type: "object",
  properties: {
    from: { type: "string", minLength: 1 },
    strategy: { type: "string", enum: ["auto", "symlink", "transform"] },
    scope: { type: "string", enum: ["project", "user", "merged"] }
  },
  required: ["from"],
  additionalProperties: false
};

const stepDefinitionSchema: JsonSchema = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: PIPELINE_STEP_MODES
    },
    prompt: {
      type: "string",
      minLength: 1
    },
    agent: {
      type: "string",
      minLength: 1
    },
    model: {
      type: "string",
      minLength: 1
    },
    skills: {
      type: "array",
      items: {
        type: "string",
        minLength: 1
      }
    },
    hooks: stepHooksSchema
  },
  required: ["prompt"],
  additionalProperties: false
};

const stepDefinitionOverrideSchema: JsonSchema = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: PIPELINE_STEP_MODES
    },
    prompt: {
      type: "string",
      minLength: 1
    },
    agent: {
      type: "string",
      minLength: 1
    },
    model: {
      type: "string",
      minLength: 1
    },
    skills: {
      type: "array",
      items: {
        type: "string",
        minLength: 1
      }
    },
    hooks: stepHooksSchema
  },
  additionalProperties: false
};

const nullableStepDefinitionSchema: JsonSchema = {
  anyOf: [
    stepDefinitionSchema,
    {
      type: "null"
    },
    {
      const: false
    }
  ]
};

const mcpServerSchema: JsonSchema = {
  type: "object",
  properties: {
    command: {
      type: "string",
      minLength: 1
    },
    args: {
      type: "array",
      items: {
        type: "string"
      }
    },
    env: {
      type: "object",
      additionalProperties: {
        type: "string"
      }
    }
  },
  required: ["command"],
  additionalProperties: false
};

export const pipelineDocumentSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: pipelineDocumentSchemaId,
  title: "Pipeline plan document",
  type: "object",
  properties: {
    $schema: {
      type: "string",
      const: pipelineDocumentSchemaId
    },
    kind: {
      type: "string",
      const: "pipeline"
    },
    version: {
      type: "integer",
      const: 1
    },
    readiness: {
      type: "string",
      enum: ["draft", "ready"]
    },
    name: {
      type: "string"
    },
    state: {
      type: "string"
    },
    extends: {
      type: "string",
      minLength: 1,
      default: "default"
    },
    steps: {
      type: "object",
      additionalProperties: stepDefinitionOverrideSchema
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            minLength: 1
          },
          title: {
            type: "string",
            minLength: 1
          },
          prompt: {
            type: "string",
            minLength: 1
          },
          status: {
            anyOf: [
              pipelineStatusSchema,
              {
                type: "object",
                additionalProperties: pipelineStatusSchema
              }
            ]
          }
        },
        required: ["id", "title", "prompt", "status"],
        additionalProperties: false
      }
    },
    vars: {
      type: "object",
      additionalProperties: {
        type: "string"
      }
    },
    setup: nullableStepDefinitionSchema,
    teardown: nullableStepDefinitionSchema,
    finalization: {
      type: "string",
      enum: ["pending", "teardown_completed", "completed"],
      description: "Durable finalization progress for resuming teardown and archiving."
    },
    mcp: {
      type: "object",
      additionalProperties: mcpServerSchema
    }
  },
  required: ["kind", "version", "tasks"],
  additionalProperties: true
};

function trimCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function stripBom(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

export function getYamlContent(planContent: string): string {
  const content = stripBom(planContent);
  const lines = content.split("\n");

  if (trimCarriageReturn(lines[0] ?? "") !== "---") {
    return content;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (trimCarriageReturn(lines[index] ?? "") !== "---") {
      continue;
    }
    return lines.slice(1, index).join("\n");
  }

  throw new Error("Invalid plan markdown: missing closing frontmatter delimiter.");
}

function asRequiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Missing ${field}`);
}

function normalizeStatus(value: unknown, field: string): PipelineStatus {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${field}: expected "open", "done", or "failed".`);
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "open" || normalized === "done" || normalized === "failed") {
    return normalized;
  }

  throw new Error(`Invalid ${field} "${value}". Expected "open", "done", or "failed".`);
}

function rejectUnknownProperties(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label = ""
): void {
  const allowedProperties = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedProperties.has(key)) {
      throw new Error(`Invalid plan YAML: unknown property "${label}${key}".`);
    }
  }
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function parseTaskStatus(
  value: unknown,
  availableSteps: ResolvedStepDefinitions | undefined,
  taskId: string
): PipelineTask["status"] {
  if (typeof value === "string") {
    return normalizeStatus(value, "task status");
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid status for task "${taskId}": expected a string or step-status map.`);
  }

  const statusMap: Record<string, PipelineStatus> = {};
  const stepStatuses = Object.entries(value);
  if (stepStatuses.length === 0) {
    throw new Error(`Invalid status for task "${taskId}": expected at least one step status.`);
  }
  for (const [stepName, stepStatus] of stepStatuses) {
    if (stepName.length === 0) {
      throw new Error(`Invalid status for task "${taskId}": step names must be non-empty.`);
    }
    if (availableSteps && !Object.hasOwn(availableSteps, stepName)) {
      throw new Error(`Unknown step "${stepName}" referenced by task "${taskId}".`);
    }
    defineRecordEntry(statusMap, stepName, normalizeStatus(stepStatus, `step status for "${stepName}"`));
  }

  return statusMap;
}

function parseStepMode(value: unknown, label: string): StepMode | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (PIPELINE_STEP_MODES.includes(value as StepMode)) {
    return value as StepMode;
  }
  throw new Error(`Invalid plan YAML: "${label}.mode" must be "yolo", "auto", "edit", or "read".`);
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

function parseSkills(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((skill) => typeof skill === "string")) {
    throw new Error(`Invalid plan YAML: "${label}.skills" must be an array of strings.`);
  }
  if (!value.every(isSkillReference)) {
    throw new Error(`Invalid plan YAML: "${label}.skills" must contain skill references.`);
  }
  return value;
}

function parseHooks(value: unknown, label: string): StepHooks | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid plan YAML: "${label}.hooks" must be an object.`);
  }
  rejectUnknownProperties(value, ["from", "strategy", "scope"], `${label}.hooks.`);
  const from = getOwnEntry(value, "from");
  const strategy = getOwnEntry(value, "strategy");
  const scope = getOwnEntry(value, "scope");

  if (typeof from !== "string" || from.length === 0) {
    throw new Error(`Invalid plan YAML: "${label}.hooks.from" must be a non-empty string.`);
  }
  if (
    strategy !== undefined &&
    strategy !== "auto" &&
    strategy !== "symlink" &&
    strategy !== "transform"
  ) {
    throw new Error(
      `Invalid plan YAML: "${label}.hooks.strategy" must be "auto", "symlink", or "transform".`
    );
  }
  if (
    scope !== undefined &&
    scope !== "project" &&
    scope !== "user" &&
    scope !== "merged"
  ) {
    throw new Error(
      `Invalid plan YAML: "${label}.hooks.scope" must be "project", "user", or "merged".`
    );
  }
  return {
    from,
    ...(strategy !== undefined ? { strategy } : {}),
    ...(scope !== undefined ? { scope } : {})
  };
}

function parseOptionalStepFields(
  value: Record<string, unknown>,
  label: string
): Pick<StepDefinitionOverride, "agent" | "model" | "skills" | "hooks"> {
  const result: Pick<StepDefinitionOverride, "agent" | "model" | "skills" | "hooks"> = {};

  const agent = getOwnEntry(value, "agent");
  if (agent !== undefined) {
    if (typeof agent !== "string" || agent.length === 0) {
      throw new Error(`Invalid plan YAML: "${label}.agent" must be a non-empty string.`);
    }
    result.agent = agent;
  }

  const model = getOwnEntry(value, "model");
  if (model !== undefined) {
    if (typeof model !== "string" || model.length === 0) {
      throw new Error(`Invalid plan YAML: "${label}.model" must be a non-empty string.`);
    }
    result.model = model;
  }

  const skills = parseSkills(getOwnEntry(value, "skills"), label);
  if (skills !== undefined) {
    result.skills = skills;
  }

  const hooks = parseHooks(getOwnEntry(value, "hooks"), label);
  if (hooks !== undefined) {
    result.hooks = hooks;
  }

  return result;
}

function parseStepOverride(value: unknown, label: string): StepDefinitionOverride {
  if (!isRecord(value)) {
    throw new Error(`Invalid plan YAML: "${label}" must be an object.`);
  }
  rejectUnknownProperties(value, ["mode", "prompt", "agent", "model", "skills", "hooks"], `${label}.`);

  const result: StepDefinitionOverride = {
    ...parseOptionalStepFields(value, label)
  };

  const mode = parseStepMode(getOwnEntry(value, "mode"), label);
  if (mode !== undefined) {
    result.mode = mode;
  }

  const prompt = getOwnEntry(value, "prompt");
  if (prompt !== undefined) {
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new Error(`Invalid plan YAML: "${label}.prompt" must be a non-empty string.`);
    }
    result.prompt = prompt;
  }

  return result;
}

function parseStepDef(value: unknown, label: string): StepDefinition {
  const override = parseStepOverride(value, label);
  if (override.prompt === undefined) {
    throw new Error(`Invalid plan YAML: "${label}" is missing a prompt.`);
  }

  return {
    prompt: override.prompt,
    ...(override.mode ? { mode: override.mode } : {}),
    ...(override.agent ? { agent: override.agent } : {}),
    ...(override.model ? { model: override.model } : {}),
    ...(override.skills ? { skills: override.skills } : {}),
    ...(override.hooks ? { hooks: override.hooks } : {})
  };
}

function parseMcpConfig(value: unknown): McpSpawnConfig {
  if (!isRecord(value)) {
    throw new Error('Invalid plan YAML: "mcp" must be an object.');
  }
  const result: McpSpawnConfig = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      throw new Error(`Invalid plan YAML: mcp["${name}"] must be an object.`);
    }
    rejectUnknownProperties(entry, ["command", "args", "env"], `mcp.${name}.`);
    const command = getOwnEntry(entry, "command");
    if (typeof command !== "string" || command.length === 0) {
      throw new Error(`Invalid plan YAML: mcp["${name}"].command must be a non-empty string.`);
    }
    const server: McpSpawnServer = { command };
    const args = getOwnEntry(entry, "args");
    if (args !== undefined) {
      if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) {
        throw new Error(`Invalid plan YAML: mcp["${name}"].args must be an array of strings.`);
      }
      server.args = args;
    }
    const env = getOwnEntry(entry, "env");
    if (env !== undefined) {
      if (!isRecord(env) || !Object.values(env).every((v) => typeof v === "string")) {
        throw new Error(`Invalid plan YAML: mcp["${name}"].env must be a string record.`);
      }
      server.env = env as Record<string, string>;
    }
    defineRecordEntry(result, name, server);
  }
  return result;
}

export function parsePlan(
  planContent: string,
  options: { availableSteps?: ResolvedStepDefinitions } = {}
): PipelinePlan {
  let document: unknown;
  const yamlContent = getYamlContent(planContent);
  try {
    document = parse(yamlContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid plan YAML: ${message}`);
  }

  if (!isRecord(document)) {
    throw new Error("Invalid plan YAML: expected a top-level object.");
  }
  const kind = getOwnEntry(document, "kind");
  if (kind === undefined) {
    throw new Error('Invalid plan YAML: missing required "kind".');
  }
  if (kind !== "pipeline") {
    throw new Error('Invalid plan YAML: "kind" must be "pipeline".');
  }
  const version = getOwnEntry(document, "version");
  if (version === undefined) {
    throw new Error('Invalid plan YAML: missing required "version".');
  }
  if (version !== 1) {
    throw new Error('Invalid plan YAML: "version" must be 1.');
  }

  let extendsName = "default";
  const extendsValue = getOwnEntry(document, "extends");
  if (extendsValue !== undefined) {
    if (typeof extendsValue !== "string" || extendsValue.trim().length === 0) {
      throw new Error('Invalid plan YAML: "extends" must be a non-empty string.');
    }
    extendsName = extendsValue.trim();
  }

  let stepOverrides: StepDefinitionOverrides | undefined;
  const stepsValue = getOwnEntry(document, "steps");
  if (stepsValue !== undefined) {
    if (!isRecord(stepsValue)) {
      throw new Error('Invalid plan YAML: "steps" must be an object.');
    }

    stepOverrides = {};
    for (const [stepName, value] of Object.entries(stepsValue)) {
      if (stepName.length === 0) {
        throw new Error('Invalid plan YAML: step names must be non-empty.');
      }
      defineRecordEntry(stepOverrides, stepName, parseStepOverride(value, `steps.${stepName}`));
    }
  }

  const tasksValue = getOwnEntry(document, "tasks");
  if (!Array.isArray(tasksValue)) {
    throw new Error('Invalid plan YAML: expected "tasks" to be an array.');
  }

  const ids = new Set<string>();
  const tasks = tasksValue.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`Invalid tasks[${index}]: expected an object.`);
    }
    rejectUnknownProperties(value, ["id", "title", "prompt", "status"], `tasks[${index}].`);

    const id = asRequiredString(getOwnEntry(value, "id"), `tasks[${index}].id`);
    if (ids.has(id)) {
      throw new Error(`Duplicate task id "${id}".`);
    }
    ids.add(id);

    return {
      id,
      title: asRequiredString(getOwnEntry(value, "title"), `tasks[${index}].title`),
      prompt: asRequiredString(getOwnEntry(value, "prompt"), `tasks[${index}].prompt`),
      status: parseTaskStatus(getOwnEntry(value, "status"), options.availableSteps, id)
    } satisfies PipelineTask;
  });

  const setupValue = getOwnEntry(document, "setup");
  const setup =
    setupValue === false || setupValue === null
      ? null
      : setupValue !== undefined
        ? parseStepDef(setupValue, "setup")
        : undefined;
  const teardownValue = getOwnEntry(document, "teardown");
  const teardown =
    teardownValue === false || teardownValue === null
      ? null
      : teardownValue !== undefined
        ? parseStepDef(teardownValue, "teardown")
        : undefined;

  const mcpValue = getOwnEntry(document, "mcp");
  const mcp = mcpValue !== undefined ? parseMcpConfig(mcpValue) : undefined;

  const finalization = getOwnEntry(document, "finalization");
  if (
    finalization !== undefined &&
    finalization !== "pending" &&
    finalization !== "teardown_completed" &&
    finalization !== "completed"
  ) {
    throw new Error('Invalid plan YAML: "finalization" must be "pending", "teardown_completed", or "completed".');
  }

  let vars: Record<string, string> | undefined;
  const varsValue = getOwnEntry(document, "vars");
  if (varsValue !== undefined) {
    if (!isRecord(varsValue)) {
      throw new Error('Invalid plan YAML: "vars" must be an object.');
    }
    vars = {};
    for (const [key, val] of Object.entries(varsValue)) {
      if (typeof val !== "string") {
        throw new Error(`Invalid plan YAML: vars["${key}"] must be a string.`);
      }
      defineRecordEntry(vars, key, val);
    }
  }

  return {
    extends: extendsName,
    ...(stepOverrides !== undefined ? { stepOverrides } : {}),
    tasks,
    ...(finalization !== undefined ? { finalization } : {}),
    ...(vars !== undefined ? { vars } : {}),
    ...(setup !== undefined ? { setup } : {}),
    ...(teardown !== undefined ? { teardown } : {}),
    ...(mcp !== undefined ? { mcp } : {})
  };
}
