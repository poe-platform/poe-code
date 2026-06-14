import {
  parseFrontmatter as parseSharedFrontmatter,
  stringifyFrontmatter
} from "@poe-code/frontmatter";
import type { RalphHooks } from "../types.js";

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

export interface RalphFrontmatter {
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
  additionalProperties: false
};

const DEFAULT_STATUS: RalphFrontmatter["status"] = {
  state: "open",
  iteration: 0
};

export function parseFrontmatter(content: string): {
  data: RalphFrontmatter;
  body: string;
} {
  const parsed = parseSharedFrontmatter(content);

  return {
    data: parseFrontmatterData(parsed.frontmatter),
    body: parsed.body.startsWith("\n") ? parsed.body.slice(1) : parsed.body
  };
}

export function writeFrontmatter(data: RalphFrontmatter, body: string): string {
  const serialized = {
    $schema: ralphDocumentSchemaId,
    kind: "ralph",
    version: 1,
    ...(data.agent !== undefined ? { agent: data.agent } : {}),
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

export function parseFrontmatterData(value: unknown): RalphFrontmatter {
  const defaults = createDefaultFrontmatter();
  const parsed = isRecord(value) ? value : undefined;
  if (parsed !== undefined) {
    rejectUnknownKeys(
      parsed,
      [
        "$schema",
        "kind",
        "version",
        "name",
        "state",
        "agent",
        "extends",
        "iterations",
        "skills",
        "hooks",
        "status",
        "iteration",
        "prompt"
      ],
      "frontmatter"
    );
    const kind = getOwnEntry(parsed, "kind");
    if (kind !== undefined && kind !== "ralph") {
      throw new Error('Invalid Ralph frontmatter: "kind" must be "ralph".');
    }
  }
  const statusValue = parsed ? getOwnEntry(parsed, "status") : undefined;
  const parsedStatus = isRecord(statusValue) ? statusValue : undefined;
  const state =
    parsePlanStatus(parsedStatus ? getOwnEntry(parsedStatus, "state") : undefined) ??
    parseLegacyStatus(statusValue) ??
    defaults.status.state;
  const iteration =
    parseNonNegativeInteger(parsedStatus ? getOwnEntry(parsedStatus, "iteration") : undefined) ??
    parseNonNegativeInteger(parsed ? getOwnEntry(parsed, "iteration") : undefined) ??
    defaults.status.iteration;
  const agent = parseAgent(parsed ? getOwnEntry(parsed, "agent") : undefined);
  const extendsValue = parseBoolean(parsed ? getOwnEntry(parsed, "extends") : undefined);
  const iterations = parsePositiveInteger(parsed ? getOwnEntry(parsed, "iterations") : undefined);
  const skills = parseSkills(parsed ? getOwnEntry(parsed, "skills") : undefined);
  const hooks = parseHooks(parsed ? getOwnEntry(parsed, "hooks") : undefined);

  return {
    ...(agent !== undefined ? { agent } : {}),
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

function parseAgent(value: unknown): RalphFrontmatter["agent"] | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  if (value.length === 0) {
    return [];
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

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}
