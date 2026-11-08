import {
  FrontmatterKindError,
  parseFrontmatter as parseSharedFrontmatter,
  stringifyFrontmatter
} from "@poe-code/frontmatter";
import type { RalphHooks } from "../types.js";
type PlanReadiness = "draft" | "ready";

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

export type RalphPlanStatus = "open" | "in_progress" | "completed" | "failed";

function parsePlanReadiness(value: unknown): PlanReadiness {
  if (value === "draft" || value === "ready") return value;
  throw new Error(`Invalid plan readiness ${JSON.stringify(value)}; expected "draft" or "ready".`);
}

export interface RalphFrontmatter {
  readiness?: PlanReadiness;
  agent?: string | string[];
  extends?: boolean;
  iterations?: number;
  skills?: string[];
  hooks?: RalphHooks;
  status: {
    state: RalphPlanStatus;
    iteration: number;
  };
}

export const ralphDocumentSchemaId =
  "https://poe-platform.github.io/poe-code/schemas/plans/ralph.schema.json";

export const ralphDocumentSchema: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: ralphDocumentSchemaId,
  title: "Ralph plan document",
  type: "object",
  properties: {
    $schema: {
      type: "string",
      const: ralphDocumentSchemaId
    },
    kind: {
      type: "string",
      const: "ralph"
    },
    version: {
      type: "integer",
      const: 1
    },
    readiness: {
      type: "string",
      enum: ["draft", "ready"]
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
    iterations: {
      type: "integer",
      minimum: 1
    },
    skills: {
      type: "array",
      items: {
        type: "string",
        minLength: 1
      }
    },
    hooks: {
      type: "object",
      properties: {
        from: {
          type: "string",
          minLength: 1
        },
        strategy: {
          type: "string",
          enum: ["auto", "symlink", "transform"]
        },
        scope: {
          type: "string",
          enum: ["project", "user", "merged"]
        }
      },
      required: ["from"],
      additionalProperties: false
    },
    status: {
      type: "object",
      properties: {
        state: {
          type: "string",
          enum: ["open", "in_progress", "completed", "failed"]
        },
        iteration: {
          type: "integer",
          minimum: 0
        }
      },
      required: ["state", "iteration"],
      additionalProperties: false
    }
  },
  required: ["kind", "version", "status"],
  additionalProperties: true
};

const DEFAULT_STATUS: RalphFrontmatter["status"] = {
  state: "open",
  iteration: 0
};

export function parseFrontmatter(
  content: string,
  options: { adoptForeignKind?: boolean } = {}
): {
  data: RalphFrontmatter;
  body: string;
} {
  const parsed = parseSharedFrontmatter(content);

  return {
    data: parseFrontmatterData(parsed.frontmatter, options),
    body: parsed.body.startsWith("\n") ? parsed.body.slice(1) : parsed.body
  };
}

export function writeFrontmatter(data: RalphFrontmatter, body: string): string {
  const serialized = {
    $schema: ralphDocumentSchemaId,
    kind: "ralph",
    version: 1,
    ...(data.agent !== undefined ? { agent: data.agent } : {}),
    ...(data.readiness !== undefined ? { readiness: data.readiness } : {}),
    ...(data.extends !== undefined ? { extends: data.extends } : {}),
    ...(data.iterations !== undefined ? { iterations: data.iterations } : {}),
    ...(data.skills !== undefined ? { skills: data.skills } : {}),
    ...(data.hooks !== undefined ? { hooks: data.hooks } : {}),
    status: {
      state: data.status.state,
      iteration: data.status.iteration
    }
  };
  return stringifyFrontmatter(serialized, body);
}

function createDefaultFrontmatter(): RalphFrontmatter {
  return {
    status: {
      state: DEFAULT_STATUS.state,
      iteration: DEFAULT_STATUS.iteration
    }
  };
}

export function parseFrontmatterData(
  value: unknown,
  options: { adoptForeignKind?: boolean } = {}
): RalphFrontmatter {
  const defaults = createDefaultFrontmatter();
  const parsed = isRecord(value) ? value : undefined;
  if (parsed !== undefined && !options.adoptForeignKind) {
    const kind = getOwnEntry(parsed, "kind");
    if (kind !== undefined && kind !== "ralph") {
      throw new FrontmatterKindError('Invalid Ralph frontmatter: "kind" must be "ralph".', {
        expected: "ralph",
        found: typeof kind === "string" ? kind : JSON.stringify(kind)
      });
    }
  }
  const { state, iteration } = parseStatusFields(parsed, defaults.status);
  const agentValue = parsed ? getOwnEntry(parsed, "agent") : undefined;
  const agent = parseAgent(agentValue);
  if (parsed !== undefined && hasOwnEntry(parsed, "agent") && agent === undefined) {
    throw new Error(
      'Invalid Ralph frontmatter: "agent" must be a non-empty string or non-empty string array.'
    );
  }
  const extendsValue = parseBoolean(parsed ? getOwnEntry(parsed, "extends") : undefined);
  const iterationsValue = parsed ? getOwnEntry(parsed, "iterations") : undefined;
  const iterations = parsePositiveInteger(iterationsValue);
  if (parsed !== undefined && hasOwnEntry(parsed, "iterations") && iterations === undefined) {
    throw new Error('Invalid Ralph frontmatter: "iterations" must be a positive integer.');
  }
  const skills = parseSkills(parsed ? getOwnEntry(parsed, "skills") : undefined);
  const hooks = parseHooks(parsed ? getOwnEntry(parsed, "hooks") : undefined);
  const readinessValue = parsed ? getOwnEntry(parsed, "readiness") : undefined;
  const readiness = readinessValue === undefined ? undefined : parsePlanReadiness(readinessValue);

  return {
    ...(agent !== undefined ? { agent } : {}),
    ...(readiness !== undefined ? { readiness } : {}),
    ...(extendsValue !== undefined ? { extends: extendsValue } : {}),
    ...(iterations !== undefined ? { iterations } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(hooks !== undefined ? { hooks } : {}),
    status: {
      state,
      iteration
    }
  };
}

function parseStatusFields(
  parsed: Record<string, unknown> | undefined,
  defaults: RalphFrontmatter["status"]
): RalphFrontmatter["status"] {
  if (parsed === undefined) {
    return defaults;
  }

  const statusValue = getOwnEntry(parsed, "status");
  const legacyIterationValue = getOwnEntry(parsed, "iteration");
  const hasStatus = hasOwnEntry(parsed, "status");
  const hasLegacyIteration = hasOwnEntry(parsed, "iteration");
  const parsedStatus = isRecord(statusValue) ? statusValue : undefined;

  if (hasLegacyIteration && parseNonNegativeInteger(legacyIterationValue) === undefined) {
    throw new Error('Invalid Ralph frontmatter: "iteration" must be a non-negative integer.');
  }

  if (parsedStatus !== undefined) {
    rejectUnknownKeys(parsedStatus, ["state", "iteration"], "status");

    const statusStateValue = getOwnEntry(parsedStatus, "state");
    const statusIterationValue = getOwnEntry(parsedStatus, "iteration");
    const state = parsePlanStatus(statusStateValue);
    const iteration = parseNonNegativeInteger(statusIterationValue);

    if (hasOwnEntry(parsedStatus, "state") && state === undefined) {
      throw new Error(
        'Invalid Ralph frontmatter: "status.state" must be "open", "in_progress", "completed", or "failed".'
      );
    }

    if (hasOwnEntry(parsedStatus, "iteration") && iteration === undefined) {
      throw new Error(
        'Invalid Ralph frontmatter: "status.iteration" must be a non-negative integer.'
      );
    }

    return {
      state: state ?? defaults.state,
      iteration: iteration ?? parseNonNegativeInteger(legacyIterationValue) ?? defaults.iteration
    };
  }

  const legacyState = parseLegacyStatus(statusValue);
  if (hasStatus && legacyState === undefined) {
    throw new Error(
      'Invalid Ralph frontmatter: "status" must be "open", "pending", "cancelled", "overbake_abort", "in_progress", or "completed".'
    );
  }

  return {
    state: legacyState ?? defaults.state,
    iteration: parseNonNegativeInteger(legacyIterationValue) ?? defaults.iteration
  };
}

function parseAgent(value: unknown): RalphFrontmatter["agent"] | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  if (value.length === 0) {
    return undefined;
  }

  const agents: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return undefined;
    }

    const trimmed = item.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    agents.push(trimmed);
  }

  return agents;
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

function parseSkills(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((skill) => typeof skill === "string")) {
    throw new Error('Invalid Ralph frontmatter: "skills" must be an array of strings.');
  }

  if (!value.every(isSkillReference)) {
    throw new Error('Invalid Ralph frontmatter: "skills" must contain skill references.');
  }

  return value;
}

function parseHooks(value: unknown): RalphHooks | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error('Invalid Ralph frontmatter: "hooks" must be an object.');
  }

  rejectUnknownKeys(value, ["from", "strategy", "scope"], "hooks");

  const from = getOwnEntry(value, "from");
  const strategy = getOwnEntry(value, "strategy");
  const scope = getOwnEntry(value, "scope");

  if (typeof from !== "string" || from.trim().length === 0) {
    throw new Error('Invalid Ralph frontmatter: "hooks.from" must be a non-empty string.');
  }

  if (
    strategy !== undefined &&
    strategy !== "auto" &&
    strategy !== "symlink" &&
    strategy !== "transform"
  ) {
    throw new Error(
      'Invalid Ralph frontmatter: "hooks.strategy" must be "auto", "symlink", or "transform".'
    );
  }

  if (scope !== undefined && scope !== "project" && scope !== "user" && scope !== "merged") {
    throw new Error(
      'Invalid Ralph frontmatter: "hooks.scope" must be "project", "user", or "merged".'
    );
  }

  return {
    from: from.trim(),
    ...(strategy !== undefined ? { strategy } : {}),
    ...(scope !== undefined ? { scope } : {})
  };
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  label: string
): void {
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unknownKey !== undefined) {
    throw new Error(`Invalid Ralph frontmatter: unknown ${label} key "${unknownKey}".`);
  }
}

function parsePlanStatus(value: unknown): RalphPlanStatus | undefined {
  if (value === "open" || value === "in_progress" || value === "completed" || value === "failed") {
    return value;
  }

  return undefined;
}

function parseLegacyStatus(value: unknown): RalphPlanStatus | undefined {
  if (value === "in_progress" || value === "completed") {
    return value;
  }

  if (
    value === "open" ||
    value === "pending" ||
    value === "cancelled" ||
    value === "overbake_abort"
  ) {
    return "open";
  }

  return undefined;
}

function parseNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnEntry(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return hasOwnEntry(record, key) ? record[key] : undefined;
}
