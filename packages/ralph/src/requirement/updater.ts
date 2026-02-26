import { dirname } from "node:path";
import * as fsPromises from "node:fs/promises";
import { lockFile } from "../lock/lock.js";
import { parsePlan } from "../plan/parser.js";
import { writePlan } from "../plan/writer.js";
import type { Plan, Requirement, RequirementStatus } from "../plan/types.js";

type LockRelease = () => Promise<void>;
type LockFn = (path: string) => Promise<LockRelease>;

type RequirementUpdaterFileSystem = {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
};

export type UpdateRequirementStatusOptions = {
  fs?: RequirementUpdaterFileSystem;
  lock?: LockFn;
  now?: Date;
};

function lockPlanFile(path: string): Promise<LockRelease> {
  return lockFile(path, { retries: 20, minTimeout: 25, maxTimeout: 250 });
}

function findRequirement(plan: Plan, requirementId: string): Requirement {
  const req = plan.requirements.find((r) => r.id === requirementId);
  if (!req) {
    throw new Error(`Requirement not found: ${requirementId}`);
  }
  return req;
}

export async function updateRequirementStatus(
  planPath: string,
  requirementId: string,
  status: RequirementStatus,
  options: UpdateRequirementStatusOptions = {}
): Promise<void> {
  const fs = options.fs ?? (fsPromises as unknown as RequirementUpdaterFileSystem);
  const lock = options.lock ?? lockPlanFile;
  const now = options.now ?? new Date();

  await fs.mkdir(dirname(planPath), { recursive: true });

  const release = await lock(planPath);
  try {
    const yaml = await fs.readFile(planPath, "utf8");
    const plan = parsePlan(yaml);
    const req = findRequirement(plan, requirementId);

    req.status = status;

    if (status === "passed") {
      req.verifiedAt = now.toISOString();
    } else if (status === "pending" || status === "failed") {
      req.verifiedAt = undefined;
    }

    await writePlan(planPath, plan, {
      fs,
      lock: async () => async () => {}
    });
  } finally {
    await release();
  }
}
