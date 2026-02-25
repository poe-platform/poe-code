import { parse } from "yaml";
import type { Plan, Story, StoryStatus } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  throw new Error(`Invalid ${field}: expected string`);
}

function asRequiredString(value: unknown, field: string): string {
  const str = asOptionalString(value, field);
  if (!str) throw new Error(`Missing ${field}`);
  return str;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  throw new Error(`Invalid ${field}: expected number`);
}

function asStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.map((v, i) => {
      if (typeof v !== "string") throw new Error(`Invalid ${field}[${i}]: expected string`);
      return v;
    });
  }
  throw new Error(`Invalid ${field}: expected string[]`);
}

function asIsoString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  throw new Error(`Invalid ${field}: expected ISO string`);
}

function normalizeStatus(value: unknown): StoryStatus {
  if (value === undefined || value === null) return "open";
  if (typeof value !== "string") throw new Error("Invalid story status: expected string");

  const normalized = value.trim().toLowerCase();
  if (!normalized) return "open";
  if (normalized === "open") return "open";
  if (normalized === "in_progress") return "in_progress";
  if (normalized === "done") return "done";

  throw new Error(
    `Invalid story status "${value}". Expected one of: open, in_progress, done`
  );
}

const KNOWN_STORY_KEYS = new Set([
  "id", "title", "status", "dependsOn", "description",
  "acceptanceCriteria", "startedAt", "completedAt", "updatedAt"
]);

function collectExtra(record: Record<string, unknown>, knownKeys: Set<string>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  let hasExtra = false;
  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) {
      extra[key] = record[key];
      hasExtra = true;
    }
  }
  return hasExtra ? extra : undefined;
}

function parseStory(value: unknown, index: number): Story {
  if (!isRecord(value)) throw new Error(`Invalid stories[${index}]: expected object`);

  const story: Story = {
    id: asRequiredString(value.id, `stories[${index}].id`),
    title: asRequiredString(value.title, `stories[${index}].title`),
    status: normalizeStatus(value.status),
    dependsOn: asStringArray(value.dependsOn, `stories[${index}].dependsOn`),
    description: asOptionalString(value.description, `stories[${index}].description`),
    acceptanceCriteria: asStringArray(
      value.acceptanceCriteria,
      `stories[${index}].acceptanceCriteria`
    ),
    startedAt: asIsoString(value.startedAt, `stories[${index}].startedAt`),
    completedAt: asIsoString(value.completedAt, `stories[${index}].completedAt`),
    updatedAt: asIsoString(value.updatedAt, `stories[${index}].updatedAt`)
  };

  const extra = collectExtra(value, KNOWN_STORY_KEYS);
  if (extra) story._extra = extra;

  return story;
}

export function parsePlan(yamlContent: string): Plan {
  let doc: unknown;
  try {
    doc = parse(yamlContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid plan YAML: ${message}`, { cause: error });
  }

  if (!isRecord(doc)) {
    throw new Error("Invalid plan YAML: expected top-level object");
  }

  const storiesValue = doc.stories;
  const stories = storiesValue === undefined || storiesValue === null ? [] : storiesValue;
  if (!Array.isArray(stories)) {
    throw new Error("Invalid stories: expected array");
  }

  const KNOWN_PLAN_KEYS = new Set([
    "version", "project", "overview", "goals", "nonGoals", "qualityGates", "stories"
  ]);

  const plan: Plan = {
    version: asNumber(doc.version, "version"),
    project: asRequiredString(doc.project, "project"),
    overview: asOptionalString(doc.overview, "overview"),
    goals: asStringArray(doc.goals, "goals"),
    nonGoals: asStringArray(doc.nonGoals, "nonGoals"),
    qualityGates: asStringArray(doc.qualityGates, "qualityGates"),
    stories: stories.map((s, i) => parseStory(s, i))
  };

  const extra = collectExtra(doc, KNOWN_PLAN_KEYS);
  if (extra) plan._extra = extra;

  return plan;
}

