import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryFileSystem = vi.hoisted(() => {
  const { Volume, createFsFromVolume } = require("memfs") as typeof import("memfs");
  const volume = new Volume();
  return { volume, fs: createFsFromVolume(volume) };
});

vi.mock("node:fs/promises", () => memoryFileSystem.fs.promises);

import { CodeReviewYamlStore, codeReviewFileName } from "./review-store.js";

const PR_URL = "https://github.com/acme/widgets/pull/123";
const PROFILE = "security";

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

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
    expect(resumed.sessionId).toBe("session-2");
    expect(resumed.orchestratorActions.at(-1)?.action).toBe("resumed_run");
  });

  it("uses one draft filename for equivalent PR URLs with different casing", () => {
    expect(codeReviewFileName("https://github.com/Acme/Widgets/pull/123")).toBe(
      codeReviewFileName(PR_URL)
    );
  });

  it("does not treat inherited missing-process codes as stale lock owners", async () => {
    const store = new CodeReviewYamlStore({ directory, lockTimeoutMs: 0 });
    memoryFileSystem.volume.mkdirSync(directory, { recursive: true });
    const lockPath = `${directory}/${codeReviewFileName(PR_URL)}.lock`;
    memoryFileSystem.volume.writeFileSync(lockPath, "12345\n");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("process probe denied");
    });

    try {
      await withObjectPrototypeProperties({ code: "ESRCH" }, async () => {
        await expect(
          store.startRun({
            sessionId: "session-1",
            prUrl: PR_URL,
            selectedAgent: "codex",
            selectedProfiles: [PROFILE]
          })
        ).rejects.toThrow("Timed out waiting for code review lock");
      });
      expect(memoryFileSystem.volume.existsSync(lockPath)).toBe(true);
    } finally {
      killSpy.mockRestore();
    }
  });

  it("round-trips prototype-named actors through persisted YAML state", async () => {
    const store = new CodeReviewYamlStore({ directory });
    const profile = "__proto__";
    await store.startRun({
      sessionId: "session-1",
      prUrl: PR_URL,
      selectedAgent: "codex",
      selectedProfiles: [profile]
    });
    await store.addSubagent(PR_URL, profile, {
      profile,
      agent: "codex",
      status: "completed",
      completedAt: "2026-05-26T00:00:00.000Z"
    });
    await store.addRawReview(PR_URL, profile, {
      body: "Prototype-named actor review.",
      comments: []
    });

    const read = await store.read(PR_URL);

    expect(Object.hasOwn(read?.rawReviews ?? {}, profile)).toBe(true);
    expect(read?.rawReviews[profile]).toEqual({
      body: "Prototype-named actor review.",
      comments: []
    });
    expect(Object.hasOwn(read?.subagents ?? {}, profile)).toBe(true);
    expect(read?.subagents[profile]).toMatchObject({
      profile,
      agent: "codex",
      status: "completed"
    });
  });
});

describe("CodeReviewYamlStore merged draft management", () => {
  const directory = "/repo/.poe-code/code-review/reviews";

  beforeEach(() => {
    memoryFileSystem.volume.reset();
  });

  it("edits, deletes, and discards only the merged review draft", async () => {
    const store = new CodeReviewYamlStore({ directory });
    await store.startRun({
      sessionId: "session-1",
      prUrl: PR_URL,
      selectedAgent: "codex",
      selectedProfiles: [PROFILE]
    });
    await store.setMergedReview(PR_URL, {
      body: "Merged summary",
      comments: [
        { path: "src/a.ts", line: 4, body: "old" },
        { path: "src/b.ts", line: 7, body: "keep" }
      ]
    });

    const edited = await store.editMergedInlineComment(PR_URL, 0, {
      path: "src/a.ts",
      line: 5,
      body: "updated"
    });
    expect(edited.mergedReview?.comments[0]).toEqual({
      path: "src/a.ts",
      line: 5,
      body: "updated"
    });

    const deleted = await store.deleteMergedInlineComment(PR_URL, 1);
    expect(deleted.mergedReview?.comments).toEqual([
      { path: "src/a.ts", line: 5, body: "updated" }
    ]);

    const discarded = await store.discardMergedReview(PR_URL);
    expect(discarded.state).toBe("in_progress");
    expect(discarded.mergedReview).toBeUndefined();
  });
});
