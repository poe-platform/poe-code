import { describe, it, expect } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parsePlan } from "../plan/parser.js";
import type { FileSystem } from "../../../../src/utils/file-system.js";
import { updateRequirementStatus } from "./updater.js";

type LockRelease = () => Promise<void>;
type LockFn = (path: string) => Promise<LockRelease>;

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createInMemoryLock(): LockFn {
  const tailByPath = new Map<string, Promise<void>>();
  return async (path: string) => {
    const previous = tailByPath.get(path) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tailByPath.set(path, previous.then(() => current));

    await previous;

    return async () => {
      release();
      if (tailByPath.get(path) === current) {
        tailByPath.delete(path);
      }
    };
  };
}

const PLAN_WITH_REQUIREMENT = `
version: 1
project: Test
qualityGates: []
requirements:
  - id: R-001
    title: Namespacing
    scenarios: []
    status: pending
stories: []
`;

describe("updateRequirementStatus", () => {
  it("sets verifiedAt when marking a requirement passed", async () => {
    const path = "/plan.yaml";
    const fs = createMemFs({ [path]: PLAN_WITH_REQUIREMENT });
    const now = new Date("2026-02-25T00:00:00.000Z");

    await updateRequirementStatus(path, "R-001", "passed", {
      fs,
      lock: createInMemoryLock(),
      now
    });

    const next = parsePlan(await fs.readFile(path, "utf8"));
    expect(next.requirements[0]!.status).toBe("passed");
    expect(next.requirements[0]!.verifiedAt).toBe(now.toISOString());
  });

  it("clears verifiedAt when resetting to pending", async () => {
    const path = "/plan.yaml";
    const initial = `
version: 1
project: Test
qualityGates: []
requirements:
  - id: R-001
    title: Namespacing
    scenarios: []
    status: passed
    verifiedAt: 2026-02-24T00:00:00.000Z
stories: []
`;
    const fs = createMemFs({ [path]: initial });
    const now = new Date("2026-02-25T00:00:00.000Z");

    await updateRequirementStatus(path, "R-001", "pending", {
      fs,
      lock: createInMemoryLock(),
      now
    });

    const next = parsePlan(await fs.readFile(path, "utf8"));
    expect(next.requirements[0]!.status).toBe("pending");
    expect(next.requirements[0]!.verifiedAt).toBeUndefined();
  });

  it("throws when updating a non-existent requirement", async () => {
    const path = "/plan.yaml";
    const fs = createMemFs({ [path]: PLAN_WITH_REQUIREMENT });

    await expect(
      updateRequirementStatus(path, "R-404", "passed", { fs, lock: createInMemoryLock() })
    ).rejects.toThrow(/R-404/);
  });

  it("acquires and releases the lock", async () => {
    const path = "/plan.yaml";
    const fs = createMemFs({ [path]: PLAN_WITH_REQUIREMENT });

    let acquired = 0;
    let released = 0;
    const lock: LockFn = async () => {
      acquired += 1;
      return async () => {
        released += 1;
      };
    };

    await updateRequirementStatus(path, "R-001", "verifying", { fs, lock });

    expect(acquired).toBe(1);
    expect(released).toBe(1);
  });
});
