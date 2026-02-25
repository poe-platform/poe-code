import { dirname } from "node:path";
import * as fsPromises from "node:fs/promises";
import { lockFile } from "../lock/lock.js";
import { stringify } from "yaml";
import type { Plan, Story } from "./types.js";

type PlanWriterFileSystem = {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
};

type LockRelease = () => Promise<void>;
type LockFn = (path: string) => Promise<LockRelease>;

export type WritePlanOptions = {
  fs?: PlanWriterFileSystem;
  lock?: LockFn;
};

function serializeStory(story: Story): Record<string, unknown> {
  const ordered: Record<string, unknown> = {
    id: story.id,
    title: story.title,
    status: story.status,
    dependsOn: story.dependsOn
  };

  if (story.description !== undefined) {
    ordered.description = story.description;
  }

  ordered.acceptanceCriteria = story.acceptanceCriteria;

  if (story.startedAt !== undefined) {
    ordered.startedAt = story.startedAt;
  }

  if (story.completedAt !== undefined) {
    ordered.completedAt = story.completedAt;
  }

  if (story.updatedAt !== undefined) {
    ordered.updatedAt = story.updatedAt;
  }

  if (story._extra) {
    Object.assign(ordered, story._extra);
  }

  return ordered;
}

function serializePlan(prd: Plan): string {
  const ordered: Record<string, unknown> = {
    version: prd.version,
    project: prd.project
  };

  if (prd.overview !== undefined) {
    ordered.overview = prd.overview;
  }

  ordered.goals = prd.goals;
  ordered.nonGoals = prd.nonGoals;
  ordered.qualityGates = prd.qualityGates;

  if (prd._extra) {
    Object.assign(ordered, prd._extra);
  }

  ordered.stories = prd.stories.map(serializeStory);

  const yaml = stringify(ordered, { lineWidth: 0 });
  return yaml.endsWith("\n") ? yaml : `${yaml}\n`;
}

function lockPlanFile(path: string): Promise<LockRelease> {
  return lockFile(path, { retries: 20, minTimeout: 25, maxTimeout: 250 });
}

export async function writePlan(
  path: string,
  prd: Plan,
  options: WritePlanOptions = {}
): Promise<void> {
  const fs = options.fs ?? fsPromises;
  const lock = options.lock ?? lockPlanFile;

  await fs.mkdir(dirname(path), { recursive: true });

  const release = await lock(path);
  try {
    const yaml = serializePlan(prd);
    await fs.writeFile(path, yaml, { encoding: "utf8" });
  } finally {
    await release();
  }
}

