import { parse } from "yaml";
import type {
  McpSpawnConfig,
  McpSpawnServer,
  PipelinePlan,
  PipelineStatus,
  PipelineTask,
  ResolvedStepDefinitions,
  StepDefinition,
  StepMode
} from "../types.js";
import { isRecord } from "../utils.js";

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

const stepDefinitionSchema: JsonSchema = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["yolo", "edit", "read"],
      default: "yolo"
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
    }
  },
  required: ["prompt"],
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
    kind: {
      type: "string",
      const: "pipeline"
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
    mcp: {
      type: "object",
      additionalProperties: mcpServerSchema
    }
  },
  required: ["kind", "tasks"],
  additionalProperties: false
};

function trimCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function stripBom(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

function getYamlContent(planContent: string): string {
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
  for (const [stepName, stepStatus] of Object.entries(value)) {
    if (availableSteps && !(stepName in availableSteps)) {
      throw new Error(`Unknown step "${stepName}" referenced by task "${taskId}".`);
    }
    statusMap[stepName] = normalizeStatus(stepStatus, `step status for "${stepName}"`);
  }

  return statusMap;
}

function asStepMode(value: unknown): StepMode {
  if (value === "edit" || value === "read") return value;
  return "yolo";
}

function parseStepDef(value: unknown, label: string): StepDefinition {
  if (!isRecord(value)) {
    throw new Error(`Invalid plan YAML: "${label}" must be an object.`);
  }
  const prompt = value.prompt;
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error(`Invalid plan YAML: "${label}" is missing a prompt.`);
  }
  return {
    mode: asStepMode(value.mode),
    prompt,
    ...(typeof value.agent === "string" && value.agent.length > 0 ? { agent: value.agent } : {}),
    ...(typeof value.model === "string" && value.model.length > 0 ? { model: value.model } : {})
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
    if (typeof entry.command !== "string" || entry.command.length === 0) {
      throw new Error(`Invalid plan YAML: mcp["${name}"].command must be a non-empty string.`);
    }
    const server: McpSpawnServer = { command: entry.command };
    if (entry.args !== undefined) {
      if (!Array.isArray(entry.args) || !entry.args.every((a) => typeof a === "string")) {
        throw new Error(`Invalid plan YAML: mcp["${name}"].args must be an array of strings.`);
      }
      server.args = entry.args as string[];
    }
    if (entry.env !== undefined) {
      if (!isRecord(entry.env) || !Object.values(entry.env).every((v) => typeof v === "string")) {
        throw new Error(`Invalid plan YAML: mcp["${name}"].env must be a string record.`);
      }
      server.env = entry.env as Record<string, string>;
    }
    result[name] = server;
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

  const tasksValue = document.tasks;
  if (!Array.isArray(tasksValue)) {
    throw new Error('Invalid plan YAML: expected "tasks" to be an array.');
  }

  const ids = new Set<string>();
  const tasks = tasksValue.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`Invalid tasks[${index}]: expected an object.`);
    }

    const id = asRequiredString(value.id, `tasks[${index}].id`);
    if (ids.has(id)) {
      throw new Error(`Duplicate task id "${id}".`);
    }
    ids.add(id);

    return {
      id,
      title: asRequiredString(value.title, `tasks[${index}].title`),
      prompt: asRequiredString(value.prompt, `tasks[${index}].prompt`),
      status: parseTaskStatus(value.status, options.availableSteps, id)
    } satisfies PipelineTask;
  });

  const setup =
    document.setup === false || document.setup === null
      ? null
      : document.setup !== undefined
        ? parseStepDef(document.setup, "setup")
        : undefined;
  const teardown =
    document.teardown === false || document.teardown === null
      ? null
      : document.teardown !== undefined
        ? parseStepDef(document.teardown, "teardown")
        : undefined;

  const mcpValue = document.mcp;
  const mcp = mcpValue !== undefined ? parseMcpConfig(mcpValue) : undefined;

  let vars: Record<string, string> | undefined;
  if (document.vars !== undefined) {
    if (!isRecord(document.vars)) {
      throw new Error('Invalid plan YAML: "vars" must be an object.');
    }
    vars = {};
    for (const [key, val] of Object.entries(document.vars)) {
      if (typeof val !== "string") {
        throw new Error(`Invalid plan YAML: vars["${key}"] must be a string.`);
      }
      vars[key] = val;
    }
  }

  return {
    tasks,
    ...(vars !== undefined ? { vars } : {}),
    ...(setup !== undefined ? { setup } : {}),
    ...(teardown !== undefined ? { teardown } : {}),
    ...(mcp !== undefined ? { mcp } : {})
  };
}
