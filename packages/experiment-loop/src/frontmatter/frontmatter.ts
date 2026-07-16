import { FrontmatterKindError } from "@poe-code/frontmatter";
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
  required: [],
  additionalProperties: true
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
  validateDocumentKind(parsed ? getOwnEntry(parsed, "kind") : undefined);
  validateDocumentVersion(parsed ? getOwnEntry(parsed, "version") : undefined);
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
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => parseMetricDefinition(item, `metric[${index}]`));
  }

  return parseMetricDefinition(value, "metric");
}

function parseMetricDefinition(value: unknown, label: string): MetricDef {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const name = parseRequiredString(getOwnEntry(value, "name"), `${label}.name`);
  const script = parseRequiredString(getOwnEntry(value, "script"), `${label}.script`);
  const direction = parseRequiredMetricDirection(
    getOwnEntry(value, "direction"),
    `${label}.direction`
  );

  const deltaValue = getOwnEntry(value, "delta");
  if (
    deltaValue !== undefined &&
    (typeof deltaValue !== "number" || !Number.isFinite(deltaValue) || deltaValue < 0)
  ) {
    throw new Error(`${label}.delta must be a non-negative number.`);
  }

  return {
    name,
    script,
    direction,
    ...(deltaValue !== undefined ? { delta: deltaValue } : {})
  };
}

function parseRequiredMetricDirection(value: unknown, label: string): MetricDef["direction"] {
  if (value === "minimize" || value === "maximize" || value === "stable") {
    return value;
  }

  throw new Error(`${label} must be one of "minimize", "maximize", or "stable".`);
}

function parseBaseline(value: unknown): Record<string, number> | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new Error("baseline must be null or an object.");
  }

  const baselineEntries = Object.entries(value).map(([key, entryValue]) => {
    if (typeof entryValue !== "number" || !Number.isFinite(entryValue)) {
      throw new Error(`baseline.${key} must be a finite number.`);
    }

    return [key, entryValue] as const;
  });

  return Object.fromEntries(baselineEntries);
}

function parseAgent(value: unknown): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return parseRequiredString(value, "agent");
  }

  if (!Array.isArray(value)) {
    throw new Error("agent must be a non-empty string or an array of non-empty strings.");
  }

  if (value.length === 0) {
    throw new Error("agent must contain at least one agent.");
  }

  const agents: string[] = [];
  for (const [index, item] of value.entries()) {
    agents.push(parseRequiredString(item, `agent[${index}]`));
  }

  return agents;
}

function parseString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseRequiredString(value: unknown, label: string): string {
  const parsed = parseString(value);
  if (parsed === undefined) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return parsed;
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
    throw new FrontmatterKindError("Experiment document kind must be 'experiment'.", {
      expected: "experiment",
      found: typeof value === "string" ? value : JSON.stringify(value)
    });
  }
}

function validateDocumentVersion(value: unknown): void {
  if (value !== undefined && value !== 1) {
    throw new Error("Experiment document version must be 1.");
  }
}
