import matter from "gray-matter";
import { dirname } from "node:path";
import type { ExperimentFileSystem, MetricDef } from "../types.js";

export interface ExperimentFrontmatterStatus {
  state: string;
  experiment: number;
  kept: number;
}

export interface ExperimentFrontmatter {
  agent?: string | string[];
  metric?: MetricDef | MetricDef[];
  baseline: Record<string, number> | null;
  maxExperiments?: number;
  metricTimeout?: number;
  model?: string;
  status: ExperimentFrontmatterStatus;
}

const DEFAULT_STATUS: ExperimentFrontmatterStatus = {
  state: "open",
  experiment: 0,
  kept: 0
};

export function parseExperimentFrontmatter(content: string): {
  frontmatter: ExperimentFrontmatter;
  body: string;
} {
  const parsed = matter(content);

  return {
    frontmatter: parseFrontmatterData(parsed.data),
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

  const serialized = matter.stringify(body, serializeFrontmatter(frontmatter));
  const content =
    body.endsWith("\n") || !serialized.endsWith("\n") ? serialized : serialized.slice(0, -1);

  await fs.writeFile(docPath, content);
}

function parseFrontmatterData(value: unknown): ExperimentFrontmatter {
  const parsed = isRecord(value) ? value : undefined;
  const agent = parseAgent(parsed?.agent);
  const metric = parseMetric(parsed?.metric);
  const maxExperiments = parseNonNegativeInteger(parsed?.maxExperiments);
  const metricTimeout = parseNonNegativeInteger(parsed?.metricTimeout);
  const model = parseString(parsed?.model);

  return {
    ...(agent !== undefined ? { agent } : {}),
    ...(metric !== undefined ? { metric } : {}),
    baseline: parseBaseline(parsed?.baseline),
    ...(maxExperiments !== undefined ? { maxExperiments } : {}),
    ...(metricTimeout !== undefined ? { metricTimeout } : {}),
    ...(model !== undefined ? { model } : {}),
    status: parseStatus(parsed?.status)
  };
}

function serializeFrontmatter(frontmatter: ExperimentFrontmatter): Record<string, unknown> {
  return {
    ...(frontmatter.agent !== undefined ? { agent: frontmatter.agent } : {}),
    ...(frontmatter.metric !== undefined ? { metric: frontmatter.metric } : {}),
    baseline: frontmatter.baseline,
    ...(frontmatter.maxExperiments !== undefined ? { maxExperiments: frontmatter.maxExperiments } : {}),
    ...(frontmatter.metricTimeout !== undefined ? { metricTimeout: frontmatter.metricTimeout } : {}),
    ...(frontmatter.model !== undefined ? { model: frontmatter.model } : {}),
    status: {
      state: frontmatter.status.state,
      experiment: frontmatter.status.experiment,
      kept: frontmatter.status.kept
    }
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
  const name = parseString(parsed?.name);
  const direction = parseMetricDirection(parsed?.direction);

  if (name === undefined || direction === undefined) {
    return undefined;
  }

  return {
    name,
    direction
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

function parseStatus(value: unknown): ExperimentFrontmatterStatus {
  const parsed = isRecord(value) ? value : undefined;

  return {
    state: parseString(parsed?.state) ?? DEFAULT_STATUS.state,
    experiment: parseNonNegativeInteger(parsed?.experiment) ?? DEFAULT_STATUS.experiment,
    kept: parseNonNegativeInteger(parsed?.kept) ?? DEFAULT_STATUS.kept
  };
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

function parseNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
