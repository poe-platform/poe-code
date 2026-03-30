import { parse, stringify } from "yaml";

export type RalphPlanStatus = "open" | "in_progress" | "completed";

export interface RalphFrontmatter {
  agent?: string | string[];
  iterations?: number;
  status: {
    state: RalphPlanStatus;
    iteration: number;
  };
}

const FENCE = "---";
const DEFAULT_STATUS: RalphFrontmatter["status"] = {
  state: "open",
  iteration: 0
};

export function parseFrontmatter(content: string): {
  data: RalphFrontmatter;
  body: string;
} {
  if (!content.startsWith(`${FENCE}\n`)) {
    return {
      data: createDefaultFrontmatter(),
      body: content
    };
  }

  const closingIndex = content.indexOf(`\n${FENCE}\n`, FENCE.length);
  if (closingIndex === -1) {
    return {
      data: createDefaultFrontmatter(),
      body: content
    };
  }

  const yamlBlock = content.slice(FENCE.length + 1, closingIndex);
  const body = content.slice(closingIndex + FENCE.length + 2);
  const parsed = parse(yamlBlock);

  return {
    data: parseFrontmatterData(parsed),
    body
  };
}

export function writeFrontmatter(
  data: RalphFrontmatter,
  body: string
): string {
  const serialized: RalphFrontmatter = {
    ...(data.agent !== undefined ? { agent: data.agent } : {}),
    ...(data.iterations !== undefined ? { iterations: data.iterations } : {}),
    status: {
      state: data.status.state,
      iteration: data.status.iteration
    }
  };
  const yaml = stringify(serialized).trimEnd();
  return `${FENCE}\n${yaml}\n${FENCE}\n${body}`;
}

function createDefaultFrontmatter(): RalphFrontmatter {
  return {
    status: {
      state: DEFAULT_STATUS.state,
      iteration: DEFAULT_STATUS.iteration
    }
  };
}

function parseFrontmatterData(value: unknown): RalphFrontmatter {
  const defaults = createDefaultFrontmatter();
  const parsed = isRecord(value) ? value : undefined;
  const parsedStatus = isRecord(parsed?.status) ? parsed.status : undefined;
  const state =
    parsePlanStatus(parsedStatus?.state) ??
    parseLegacyStatus(parsed?.status) ??
    defaults.status.state;
  const iteration =
    parseNonNegativeInteger(parsedStatus?.iteration) ??
    parseNonNegativeInteger(parsed?.iteration) ??
    defaults.status.iteration;
  const agent = parseAgent(parsed?.agent);
  const iterations = parsePositiveInteger(parsed?.iterations);

  return {
    ...(agent !== undefined ? { agent } : {}),
    ...(iterations !== undefined ? { iterations } : {}),
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

function parsePlanStatus(value: unknown): RalphPlanStatus | undefined {
  if (value === "open" || value === "in_progress" || value === "completed") {
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
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
