import matter from "gray-matter";
import { dirname } from "node:path";
import { stringify } from "yaml";
import type {
  ExperimentAgentDefinition,
  ExperimentFileSystem,
  MetricDef
} from "../types.js";

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

export interface ExperimentFrontmatter {
  agents?: Record<string, ExperimentAgentDefinition>;
  metric?: MetricDef | MetricDef[];
  maxKept?: number;
}

export const experimentDocumentSchemaId =
  "https://poe-platform.github.io/poe-code/schemas/plans/experiment.schema.json";

const metricDefinitionSchema: JsonSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      minLength: 1
    },
    direction: {
      type: "string",
      enum: ["minimize", "maximize", "stable"]
    },
    delta: {
      type: "number",
      minimum: 0
    }
  },
  required: ["name", "direction"],
  additionalProperties: false
};

const agentDefinitionSchema: JsonSchema = {
  anyOf: [
    {
      type: "string",
      minLength: 1
    },
    {
      type: "object",
      properties: {
        agent: {
          type: "string",
          minLength: 1
        },
        prompt: {
          type: "string"
        },
        model: {
          type: "string"
        },
        mode: {
          type: "string",
          enum: ["read", "edit", "yolo"]
        },
        cwd: {
          type: "string"
        },
        mcp: {
          type: "object",
          additionalProperties: {
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
              },
              timeout: {
                type: "number",
                minimum: 0
              }
            },
            required: ["command"],
            additionalProperties: false
          }
        }
      },
      required: ["agent"],
      additionalProperties: false
    }
  ]
};

export const experimentDocumentSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: experimentDocumentSchemaId,
  title: "Experiment plan document",
  type: "object",
  properties: {
    $schema: {
      type: "string",
      const: experimentDocumentSchemaId
    },
    kind: {
      type: "string",
      const: "experiment"
    },
    version: {
      type: "integer",
      const: 1
    },
    agents: {
      type: "object",
      additionalProperties: agentDefinitionSchema
    },
    metric: {
      anyOf: [
        metricDefinitionSchema,
        {
          type: "array",
          minItems: 1,
          items: metricDefinitionSchema
        }
      ]
    },
    maxKept: {
      type: "integer",
      minimum: 0
    }
  },
  required: ["kind", "version"],
  additionalProperties: false
};

export function parseExperimentFrontmatter(content: string): {
  frontmatter: ExperimentFrontmatter;
  body: string;
} {
  const parsed = matter(content);

  return {
    frontmatter: parseExperimentFrontmatterData(parsed.data),
    body: parsed.content
  };
}

export async function writeExperimentFrontmatter(
  docPath: string,
  frontmatter: ExperimentFrontmatter,
  body: string,
  fs: ExperimentFileSystem
): Promise<void> {
  await fs.mkdir(dirname(docPath), { recursive: true });

  const yaml = stringify(serializeFrontmatter(frontmatter)).trimEnd();
  const serialized = `---\n${yaml}\n---\n${body}`;
  const content =
    body.endsWith("\n") || !serialized.endsWith("\n") ? serialized : serialized.slice(0, -1);

  await fs.writeFile(docPath, content);
}

export function parseExperimentFrontmatterData(value: unknown): ExperimentFrontmatter {
  const parsed = isRecord(value) ? value : undefined;
  const agents = parseAgents(parsed?.agents);
  const metric = parseMetric(parsed?.metric);
  const maxKept = parseNonNegativeInteger(parsed?.maxKept);

  return {
    ...(agents !== undefined ? { agents } : {}),
    ...(metric !== undefined ? { metric } : {}),
    ...(maxKept !== undefined ? { maxKept } : {})
  };
}

function serializeFrontmatter(frontmatter: ExperimentFrontmatter): Record<string, unknown> {
  return {
    $schema: experimentDocumentSchemaId,
    kind: "experiment",
    version: 1,
    ...(frontmatter.agents !== undefined ? { agents: frontmatter.agents } : {}),
    ...(frontmatter.metric !== undefined ? { metric: frontmatter.metric } : {}),
    ...(frontmatter.maxKept !== undefined ? { maxKept: frontmatter.maxKept } : {})
  };
}

function parseAgents(value: unknown): Record<string, ExperimentAgentDefinition> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).map(([name, definition]) => {
    const parsedDefinition = parseAgentDefinition(definition);

    if (parsedDefinition === undefined) {
      return undefined;
    }

    return [name, parsedDefinition] as const;
  });

  if (entries.some((entry) => entry === undefined)) {
    return undefined;
  }

  return Object.fromEntries(
    entries.filter(
      (entry): entry is readonly [string, ExperimentAgentDefinition] => entry !== undefined
    )
  );
}

function parseAgentDefinition(value: unknown): ExperimentAgentDefinition | undefined {
  if (typeof value === "string") {
    return parseString(value);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const agent = parseString(value.agent);

  if (agent === undefined) {
    return undefined;
  }

  const prompt = parseString(value.prompt);
  const model = parseString(value.model);
  const cwd = parseString(value.cwd);
  const mode = parseMode(value.mode);
  const mcp = parseMcp(value.mcp);

  return {
    agent,
    ...(prompt !== undefined ? { prompt } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(mcp !== undefined ? { mcp } : {})
  };
}

function parseMcp(
  value: unknown
): ExperimentAgentDefinition extends infer T
  ? T extends { mcp?: infer TMcp }
    ? TMcp
    : never
  : never {
  if (!isRecord(value)) {
    return undefined as never;
  }

  const entries = Object.entries(value).map(([name, server]) => {
    if (!isRecord(server)) {
      return undefined;
    }

    const command = parseString(server.command);

    if (command === undefined) {
      return undefined;
    }

    const args = parseStringArray(server.args);
    const env = parseStringRecord(server.env);
    const timeout = parseNonNegativeFiniteNumber(server.timeout);

    return [
      name,
      {
        command,
        ...(args !== undefined ? { args } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(timeout !== undefined ? { timeout } : {})
      }
    ] as const;
  });

  if (entries.some((entry) => entry === undefined)) {
    return undefined as never;
  }

  return Object.fromEntries(
    entries.filter(
      (
        entry
      ): entry is readonly [
        string,
        {
          command: string;
          args?: string[];
          env?: Record<string, string>;
          timeout?: number;
        }
      ] => entry !== undefined
    )
  ) as never;
}

function parseMetric(value: unknown): MetricDef | MetricDef[] | undefined {
  if (Array.isArray(value)) {
    const metrics = value
      .map((item) => parseMetricDefinition(item))
      .filter((item): item is MetricDef => item !== undefined);

    return metrics.length === value.length ? metrics : undefined;
  }

  return parseMetricDefinition(value);
}

function parseMetricDefinition(value: unknown): MetricDef | undefined {
  const parsed = isRecord(value) ? value : undefined;
  const name = parseString(parsed?.name);
  const direction = parseMetricDirection(parsed?.direction);

  if (name === undefined || direction === undefined) {
    return undefined;
  }

  const delta = parseNonNegativeFiniteNumber(parsed?.delta);

  return {
    name,
    direction,
    ...(delta !== undefined ? { delta } : {})
  };
}

function parseMetricDirection(value: unknown): MetricDef["direction"] | undefined {
  return value === "minimize" || value === "maximize" || value === "stable" ? value : undefined;
}

function parseMode(
  value: unknown
): Extract<ExperimentAgentDefinition, { mode?: unknown }>["mode"] | undefined {
  return value === "read" || value === "edit" || value === "yolo" ? value : undefined;
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).map(([key, entryValue]) => {
    const parsedValue = parseString(entryValue);
    return parsedValue === undefined ? undefined : ([key, parsedValue] as const);
  });

  if (entries.some((entry) => entry === undefined)) {
    return undefined;
  }

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== undefined));
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries = value.map((entry) => parseString(entry));

  if (entries.some((entry) => entry === undefined)) {
    return undefined;
  }

  return entries.filter((entry): entry is string => entry !== undefined);
}

function parseString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parseNonNegativeFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
