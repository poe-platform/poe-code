import matter from "gray-matter";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { stringify } from "yaml";
import { hasOwnErrorCode } from "../errors.js";
import type { ExperimentFileSystem, MetricDef } from "../types.js";

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
  agent?: string | string[];
  extends?: boolean;
  metric?: MetricDef | MetricDef[];
  baseline: Record<string, number> | null;
  max_experiments?: number;
  metric_timeout?: number;
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
    script: {
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
  required: ["name", "script", "direction"],
  additionalProperties: false
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
    agent: {
      anyOf: [
        {
          type: "string",
          minLength: 1
        },
        {
          type: "array",
          minItems: 1,
          items: {
            type: "string",
            minLength: 1
          }
        }
      ]
    },
    extends: {
      type: "boolean"
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
    baseline: {
      anyOf: [
        {
          type: "null"
        },
        {
          type: "object",
          additionalProperties: {
            type: "number"
          }
        }
      ]
    },
    max_experiments: {
      type: "integer",
      minimum: 0
    },
    metric_timeout: {
      type: "integer",
      minimum: 0
    }
  },
  required: ["kind", "version", "baseline"],
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

  const temporaryPath = `${docPath}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryCreated = false;
  try {
    await fs.writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    temporaryCreated = true;
    await fs.rename(temporaryPath, docPath);
  } catch (error) {
    if (temporaryCreated || !isAlreadyExistsError(error)) {
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}

export function parseExperimentFrontmatterData(value: unknown): ExperimentFrontmatter {
  const parsed = isRecord(value) ? value : undefined;
  validateFrontmatterFields(parsed);
  validateDocumentKind(parsed ? getOwnEntry(parsed, "kind") : undefined);
  const agent = parseAgent(parsed ? getOwnEntry(parsed, "agent") : undefined);
  const extendsValue = parseBoolean(parsed ? getOwnEntry(parsed, "extends") : undefined);
  const metric = parseMetric(parsed ? getOwnEntry(parsed, "metric") : undefined);
  const max_experiments = parseOptionalNonNegativeInteger(
    parsed ? getOwnEntry(parsed, "max_experiments") : undefined,
    "max_experiments"
  );
  const metric_timeout = parseOptionalNonNegativeInteger(
    parsed ? getOwnEntry(parsed, "metric_timeout") : undefined,
    "metric_timeout"
  );

  return {
    ...(agent !== undefined ? { agent } : {}),
    ...(extendsValue !== undefined ? { extends: extendsValue } : {}),
    ...(metric !== undefined ? { metric } : {}),
    baseline: parseBaseline(parsed ? getOwnEntry(parsed, "baseline") : undefined),
    ...(max_experiments !== undefined ? { max_experiments } : {}),
    ...(metric_timeout !== undefined ? { metric_timeout } : {})
  };
}

function serializeFrontmatter(frontmatter: ExperimentFrontmatter): Record<string, unknown> {
  return {
    $schema: experimentDocumentSchemaId,
    kind: "experiment",
    version: 1,
    ...(frontmatter.agent !== undefined ? { agent: frontmatter.agent } : {}),
    ...(frontmatter.extends !== undefined ? { extends: frontmatter.extends } : {}),
    ...(frontmatter.metric !== undefined ? { metric: frontmatter.metric } : {}),
    baseline: frontmatter.baseline,
    // Frontmatter is declarative config only. Runtime experiment outcomes live in the
    // journal sidecar, so we intentionally do not persist any derived status here.
    ...(frontmatter.max_experiments !== undefined
      ? { max_experiments: frontmatter.max_experiments }
      : {}),
    ...(frontmatter.metric_timeout !== undefined
      ? { metric_timeout: frontmatter.metric_timeout }
      : {})
  };
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
  const name = parseString(parsed ? getOwnEntry(parsed, "name") : undefined);
  const script = parseString(parsed ? getOwnEntry(parsed, "script") : undefined);
  const direction = parseMetricDirection(parsed ? getOwnEntry(parsed, "direction") : undefined);

  if (name === undefined || script === undefined || direction === undefined) {
    return undefined;
  }

  const deltaValue = parsed ? getOwnEntry(parsed, "delta") : undefined;
  const delta =
    typeof deltaValue === "number" && Number.isFinite(deltaValue) && deltaValue >= 0
      ? deltaValue
      : undefined;

  return {
    name,
    script,
    direction,
    ...(delta !== undefined ? { delta } : {})
  };
}

function parseMetricDirection(value: unknown): MetricDef["direction"] | undefined {
  return value === "minimize" || value === "maximize" || value === "stable" ? value : undefined;
}

function parseBaseline(value: unknown): Record<string, number> | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const baselineEntries = Object.entries(value)
    .map(([key, entryValue]) => {
      if (typeof entryValue !== "number" || !Number.isFinite(entryValue)) {
        return undefined;
      }

      return [key, entryValue] as const;
    })
    .filter((entry): entry is readonly [string, number] => entry !== undefined);

  return baselineEntries.length === Object.keys(value).length
    ? Object.fromEntries(baselineEntries)
    : null;
}

function parseAgent(value: unknown): string | string[] | undefined {
  if (typeof value === "string") {
    return parseString(value);
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const agents: string[] = [];
  for (const item of value) {
    const parsed = parseString(item);
    if (parsed === undefined) {
      return undefined;
    }
    agents.push(parsed);
  }

  return agents.length > 0 ? agents : undefined;
}

function parseString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return value;
}

function parseBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function validateDocumentKind(value: unknown): void {
  if (value !== undefined && value !== "experiment") {
    throw new Error("Experiment document kind must be 'experiment'.");
  }
}

function validateFrontmatterFields(value: Record<string, unknown> | undefined): void {
  if (value === undefined) {
    return;
  }

  const allowedFields = new Set([
    "$schema",
    "kind",
    "version",
    "agent",
    "extends",
    "metric",
    "baseline",
    "max_experiments",
    "metric_timeout",
    "maxExperiments",
    "metricTimeout",
    "status"
  ]);

  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw new Error(`Unknown experiment frontmatter field: "${field}".`);
    }
  }
}
