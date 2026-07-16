import { describe, expect, it } from "vitest";
import type { JobEntry, StateManager } from "@poe-code/poe-code-config";
import { resolveJob } from "./shared.js";
import { ValidationError } from "../../../errors.js";

function job(overrides: Partial<JobEntry> & Pick<JobEntry, "id" | "started_at">): JobEntry {
  return {
    env_id: `env-${overrides.id}`,
    env_kind: "docker",
    tool: "codex",
    argv: ["codex"],
    cwd: "/repo",
    status: "running",
    ...overrides
  };
}

function createState(entries: JobEntry[]): StateManager {
  return {
    jobs: {
      async list() {
        return entries;
      },
      async get(id: string) {
        return entries.find((entry) => entry.id === id) ?? null;
      }
    }
  } as unknown as StateManager;
}

describe("resolveJob", () => {
  it("defaults to the unambiguously most recent candidate instead of erroring", async () => {
    const state = createState([
      job({ id: "old", started_at: "2026-06-16T10:00:00.000Z" }),
      job({ id: "newest", started_at: "2026-07-08T10:00:00.000Z" }),
      job({ id: "middle", started_at: "2026-06-25T10:00:00.000Z" })
    ]);

    await expect(resolveJob(state, undefined, "running")).resolves.toMatchObject({ id: "newest" });
  });

  it("caps the candidate list and reports a user error when the newest match is ambiguous", async () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      job({ id: `job-${index}`, started_at: "2026-07-08T10:00:00.000Z" })
    );
    const state = createState(entries);

    const error = await resolveJob(state, undefined, "pullable").catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ValidationError);
    const message = (error as Error).message;
    expect(message.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(5);
    expect(message).toContain("3 more");
  });
});
