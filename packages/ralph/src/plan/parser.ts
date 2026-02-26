import { parse } from "yaml";
import type { Plan, Requirement, RequirementScenario, RequirementStatus, Story, StoryStatus } from "./types.js";

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

const KNOWN_REQUIREMENT_KEYS = new Set([
  "id", "title", "description", "scenarios", "status", "verifiedAt"
]);

function normalizeRequirementStatus(value: unknown): RequirementStatus {
  if (value === undefined || value === null) return "pending";
  if (typeof value !== "string") throw new Error("Invalid requirement status: expected string");

  const normalized = value.trim().toLowerCase();
  if (!normalized) return "pending";
  if (normalized === "pending") return "pending";
  if (normalized === "verifying") return "verifying";
  if (normalized === "passed") return "passed";
  if (normalized === "failed") return "failed";

  throw new Error(
    `Invalid requirement status "${value}". Expected one of: pending, verifying, passed, failed`
  );
}

function parseScenario(value: unknown, index: number, reqIndex: number): RequirementScenario {
  if (!isRecord(value)) throw new Error(`Invalid requirements[${reqIndex}].scenarios[${index}]: expected object`);
  return {
    name: asRequiredString(value.name, `requirements[${reqIndex}].scenarios[${index}].name`),
    when: asRequiredString(value.when, `requirements[${reqIndex}].scenarios[${index}].when`),
    then: asRequiredString(value.then, `requirements[${reqIndex}].scenarios[${index}].then`)
  };
}

function parseRequirement(value: unknown, index: number): Requirement {
  if (!isRecord(value)) throw new Error(`Invalid requirements[${index}]: expected object`);

  const scenariosValue = value.scenarios;
  const scenarios = scenariosValue === undefined || scenariosValue === null ? [] : scenariosValue;
  if (!Array.isArray(scenarios)) {
    throw new Error(`Invalid requirements[${index}].scenarios: expected array`);
  }

  const id = asOptionalString(value.id, `requirements[${index}].id`) ?? `R-${String(index + 1).padStart(3, "0")}`;
  const req: Requirement = {
    id,
    title: asOptionalString(value.title, `requirements[${index}].title`) ?? `Requirement ${id}`,
    description: asOptionalString(value.description, `requirements[${index}].description`),
    scenarios: scenarios.map((s, i) => parseScenario(s, i, index)),
    status: normalizeRequirementStatus(value.status),
    verifiedAt: asIsoString(value.verifiedAt, `requirements[${index}].verifiedAt`)
  };

  const extra = collectExtra(value as Record<string, unknown>, KNOWN_REQUIREMENT_KEYS);
  if (extra) req._extra = extra;

  return req;
}

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

  const requirementsValue = doc.requirements;
  const requirements = requirementsValue === undefined || requirementsValue === null ? [] : requirementsValue;
  if (!Array.isArray(requirements)) {
    throw new Error("Invalid requirements: expected array");
  }

  const KNOWN_PLAN_KEYS = new Set([
    "version", "project", "overview", "goals", "nonGoals", "qualityGates", "requirements", "stories"
  ]);

  const plan: Plan = {
    version: asNumber(doc.version, "version"),
    project: asRequiredString(doc.project, "project"),
    overview: asOptionalString(doc.overview, "overview"),
    goals: asStringArray(doc.goals, "goals"),
    nonGoals: asStringArray(doc.nonGoals, "nonGoals"),
    qualityGates: asStringArray(doc.qualityGates, "qualityGates"),
    requirements: requirements.map((r, i) => parseRequirement(r, i)),
    stories: stories.map((s, i) => parseStory(s, i))
  };

  const extra = collectExtra(doc, KNOWN_PLAN_KEYS);
  if (extra) plan._extra = extra;

  return plan;
}

