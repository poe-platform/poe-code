import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryFileSystem = vi.hoisted(() => {
  const { Volume, createFsFromVolume } = require("memfs") as typeof import("memfs");
  const volume = new Volume();
  return { volume, fs: createFsFromVolume(volume) };
});

vi.mock("node:fs/promises", () => memoryFileSystem.fs.promises);

import { CodeReviewYamlStore } from "./review-store.js";

const PR_URL = "https://github.com/acme/widgets/pull/123";
const PROFILE = "security";

describe("CodeReviewYamlStore.startRun resume semantics", () => {
  const directory = "/repo/.poe-code/code-review/reviews";

  beforeEach(() => {
    memoryFileSystem.volume.reset();
  });

  it("clears raw_reviews and subagent state on rerun so the new PR diff is reanalyzed", async () => {
    const store = new CodeReviewYamlStore({ directory });
    await store.startRun({
      sessionId: "session-1",
      prUrl: PR_URL,
      selectedAgent: "codex",
      selectedProfiles: [PROFILE]
    });
    await store.addSubagent(PR_URL, PROFILE, {
      profile: PROFILE,
      agent: "codex",
      status: "completed",
      completedAt: "2026-05-26T00:00:00.000Z"
    });
    await store.addRawReview(PR_URL, PROFILE, {
      body: "Prior findings against the old diff.",
      comments: []
    });

    const resumed = await store.startRun({
      sessionId: "session-2",
      prUrl: PR_URL,
      selectedAgent: "codex",
      selectedProfiles: [PROFILE]
    });

    expect(resumed.rawReviews).toEqual({});
    expect(resumed.subagents).toEqual({});
    expect(resumed.orchestratorActions.at(-1)?.action).toBe("resumed_run");
  });
});
