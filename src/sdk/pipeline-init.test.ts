import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const spawnAutonomousMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("./spawn.js", () => ({
  spawn: Object.assign(vi.fn(), {
    autonomous: spawnAutonomousMock
  })
}));

const { runPipelineInit } = await import("./pipeline.js");

const cwd = "/repo";
const homeDir = "/home/test";

function seedFs(files: Record<string, string>): void {
  vol.reset();
  vol.fromJSON(files, "/");
  vol.mkdirSync(cwd, { recursive: true });
  vol.mkdirSync(homeDir, { recursive: true });
}

describe("SDK pipeline init", () => {
  beforeEach(() => {
    spawnAutonomousMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("processes two sources successfully", async () => {
    seedFs({
      "/repo/.poe-code/.keep": "",
      "/repo/docs/plans/alpha.md": "# Alpha\nFirst source.\n",
      "/repo/docs/plans/beta.md": "# Beta\nSecond source.\n"
    });

    const runAgent = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "alpha", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "beta", stderr: "", exitCode: 0 });
    const onSourceStart = vi.fn();
    const onSourceComplete = vi.fn();

    const result = await runPipelineInit({
      agent: "codex",
      model: "gpt-5.2",
      cwd,
      homeDir,
      sources: [
        {
          absolutePath: "/repo/docs/plans/alpha.md",
          relativePath: "alpha.md",
          title: "Alpha"
        },
        {
          absolutePath: "/repo/docs/plans/beta.md",
          relativePath: "beta.md",
          title: "Beta"
        }
      ],
      question: "Initialize the pipeline plans",
      assumeYes: true,
      runAgent,
      onSourceStart,
      onSourceComplete
    });

    expect(result).toEqual({
      stopReason: "done",
      sourcesProcessed: 2
    });
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(runAgent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        agent: "codex",
        cwd,
        model: "gpt-5.2"
      })
    );
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain(
      "Edit alpha.md directly"
    );
    expect(runAgent.mock.calls[0]?.[0].prompt).not.toContain("Plan directory:");
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("Path: alpha.md");
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("# Alpha\nFirst source.");
    expect(runAgent.mock.calls[0]?.[0].prompt).toContain("Initialize the pipeline plans");
    expect(runAgent.mock.calls[1]?.[0].prompt).toContain("Path: beta.md");
    expect(runAgent.mock.calls[1]?.[0].prompt).toContain("# Beta\nSecond source.");
    expect(onSourceStart).toHaveBeenNthCalledWith(
      1,
      {
        absolutePath: "/repo/docs/plans/alpha.md",
        relativePath: "alpha.md",
        title: "Alpha"
      },
      1,
      2
    );
    expect(onSourceStart).toHaveBeenNthCalledWith(
      2,
      {
        absolutePath: "/repo/docs/plans/beta.md",
        relativePath: "beta.md",
        title: "Beta"
      },
      2,
      2
    );
    expect(onSourceComplete).toHaveBeenNthCalledWith(
      1,
      {
        absolutePath: "/repo/docs/plans/alpha.md",
        relativePath: "alpha.md",
        title: "Alpha"
      },
      1,
      2,
      { stdout: "alpha", stderr: "", exitCode: 0 }
    );
    expect(onSourceComplete).toHaveBeenNthCalledWith(
      2,
      {
        absolutePath: "/repo/docs/plans/beta.md",
        relativePath: "beta.md",
        title: "Beta"
      },
      2,
      2,
      { stdout: "beta", stderr: "", exitCode: 0 }
    );
  });

  it("stops on the first failed source", async () => {
    seedFs({
      "/repo/.poe-code/.keep": "",
      "/repo/docs/plans/alpha.md": "# Alpha\nFirst source.\n",
      "/repo/docs/plans/beta.md": "# Beta\nSecond source.\n"
    });

    const runAgent = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "alpha", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "beta", stderr: "boom", exitCode: 1 });

    const result = await runPipelineInit({
      agent: "codex",
      cwd,
      homeDir,
      sources: [
        {
          absolutePath: "/repo/docs/plans/alpha.md",
          relativePath: "alpha.md",
          title: "Alpha"
        },
        {
          absolutePath: "/repo/docs/plans/beta.md",
          relativePath: "beta.md",
          title: "Beta"
        }
      ],
      assumeYes: true,
      runAgent
    });

    expect(result).toEqual({
      stopReason: "failed",
      sourcesProcessed: 1,
      failedSource: "beta.md"
    });
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it("returns failed when the agent runner throws for a source", async () => {
    seedFs({
      "/repo/.poe-code/.keep": "",
      "/repo/docs/plans/alpha.md": "# Alpha\nFirst source.\n",
      "/repo/docs/plans/beta.md": "# Beta\nSecond source.\n"
    });

    const runAgent = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "alpha", stderr: "", exitCode: 0 })
      .mockRejectedValueOnce(new Error("spawn failed"));

    const result = await runPipelineInit({
      agent: "codex",
      cwd,
      homeDir,
      sources: [
        {
          absolutePath: "/repo/docs/plans/alpha.md",
          relativePath: "alpha.md",
          title: "Alpha"
        },
        {
          absolutePath: "/repo/docs/plans/beta.md",
          relativePath: "beta.md",
          title: "Beta"
        }
      ],
      assumeYes: true,
      runAgent
    });

    expect(result).toEqual({
      stopReason: "failed",
      sourcesProcessed: 1,
      failedSource: "beta.md"
    });
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it("returns cancelled before starting when already aborted", async () => {
    seedFs({
      "/repo/.poe-code/.keep": "",
      "/repo/docs/plans/alpha.md": "# Alpha\nFirst source.\n"
    });

    const controller = new AbortController();
    controller.abort();
    const runAgent = vi.fn();
    const onSourceStart = vi.fn();

    const result = await runPipelineInit({
      agent: "codex",
      cwd,
      homeDir,
      sources: [
        {
          absolutePath: "/repo/docs/plans/alpha.md",
          relativePath: "alpha.md",
          title: "Alpha"
        }
      ],
      assumeYes: true,
      runAgent,
      signal: controller.signal,
      onSourceStart
    });

    expect(result).toEqual({
      stopReason: "cancelled",
      sourcesProcessed: 0
    });
    expect(runAgent).not.toHaveBeenCalled();
    expect(onSourceStart).not.toHaveBeenCalled();
  });

  it("returns cancelled when aborted between sources", async () => {
    seedFs({
      "/repo/.poe-code/.keep": "",
      "/repo/docs/plans/alpha.md": "# Alpha\nFirst source.\n",
      "/repo/docs/plans/beta.md": "# Beta\nSecond source.\n"
    });

    const controller = new AbortController();
    const runAgent = vi.fn().mockResolvedValue({ stdout: "alpha", stderr: "", exitCode: 0 });
    const onSourceComplete = vi.fn(() => {
      controller.abort();
    });

    const result = await runPipelineInit({
      agent: "codex",
      cwd,
      homeDir,
      sources: [
        {
          absolutePath: "/repo/docs/plans/alpha.md",
          relativePath: "alpha.md",
          title: "Alpha"
        },
        {
          absolutePath: "/repo/docs/plans/beta.md",
          relativePath: "beta.md",
          title: "Beta"
        }
      ],
      assumeYes: true,
      runAgent,
      signal: controller.signal,
      onSourceComplete
    });

    expect(result).toEqual({
      stopReason: "cancelled",
      sourcesProcessed: 1
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("returns cancelled when the final source aborts while resolving", async () => {
    seedFs({
      "/repo/.poe-code/.keep": "",
      "/repo/docs/plans/alpha.md": "# Alpha\nFirst source.\n"
    });

    const controller = new AbortController();
    const runAgent = vi.fn(async () => {
      controller.abort();
      return { stdout: "alpha", stderr: "", exitCode: 0 };
    });

    const result = await runPipelineInit({
      agent: "codex",
      cwd,
      homeDir,
      sources: [
        {
          absolutePath: "/repo/docs/plans/alpha.md",
          relativePath: "alpha.md",
          title: "Alpha"
        }
      ],
      assumeYes: true,
      runAgent,
      signal: controller.signal
    });

    expect(result).toEqual({
      stopReason: "cancelled",
      sourcesProcessed: 0
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
  });
});
