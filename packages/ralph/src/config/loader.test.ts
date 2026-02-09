import { describe, it, expect } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "../../../../src/utils/file-system.js";
import { loadConfig } from "./loader.js";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const vol = Volume.fromJSON(files, "/");
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("loadConfig", () => {
  it("loads config.yaml when present", async () => {
    const cwd = "/repo";
    const fs = createMemFs({
      "/repo/.agents/poe-code-ralph/config.yaml": [
        "agent: claude-code",
        "maxIterations: 7",
        "noCommit: true",
        "staleSeconds: 120",
        "planPath: .agents/tasks/plan.yaml",
        "progressPath: .poe-code-ralph/progress.md",
        "guardrailsPath: .poe-code-ralph/guardrails.md",
        "errorsLogPath: .poe-code-ralph/errors.log",
        "activityLogPath: .poe-code-ralph/activity.log",
        "unknownKey: ignored",
        ""
      ].join("\n")
    });

    const result = await loadConfig(cwd, { fs: fs as any });
    expect(result.config).toEqual({
      planPath: ".agents/tasks/plan.yaml",
      progressPath: ".poe-code-ralph/progress.md",
      guardrailsPath: ".poe-code-ralph/guardrails.md",
      errorsLogPath: ".poe-code-ralph/errors.log",
      activityLogPath: ".poe-code-ralph/activity.log",
      agent: "claude-code",
      maxIterations: 7,
      noCommit: true,
      staleSeconds: 120
    });
    expect(result.sources).toEqual([
      { path: "/repo/.agents/poe-code-ralph/config.yaml", scope: "local" }
    ]);
  });

  it("falls back to config.json when yaml is missing", async () => {
    const cwd = "/repo";
    const fs = createMemFs({
      "/repo/.agents/poe-code-ralph/config.json": JSON.stringify({
        agent: "codex",
        maxIterations: 3,
        noCommit: false,
        staleSeconds: 0
      })
    });

    const result = await loadConfig(cwd, { fs: fs as any });
    expect(result.config).toEqual({
      agent: "codex",
      maxIterations: 3,
      noCommit: false,
      staleSeconds: 0
    });
    expect(result.sources).toEqual([
      { path: "/repo/.agents/poe-code-ralph/config.json", scope: "local" }
    ]);
  });

  it("returns an empty config when no file exists", async () => {
    const cwd = "/repo";
    const fs = createMemFs();

    const result = await loadConfig(cwd, { fs: fs as any });
    expect(result.config).toEqual({});
    expect(result.sources).toEqual([]);
  });

  it("loads global config from homeDir when present", async () => {
    const cwd = "/repo";
    const homeDir = "/home/test";
    const fs = createMemFs({
      "/home/test/.poe-code/ralph/config.yaml": [
        "agent: claude-code",
        "maxIterations: 10",
        ""
      ].join("\n")
    });

    const result = await loadConfig(cwd, { fs: fs as any, homeDir });
    expect(result.config).toEqual({
      agent: "claude-code",
      maxIterations: 10
    });
    expect(result.sources).toEqual([
      { path: "/home/test/.poe-code/ralph/config.yaml", scope: "global" }
    ]);
  });

  it("local config overrides global config on overlapping fields", async () => {
    const cwd = "/repo";
    const homeDir = "/home/test";
    const fs = createMemFs({
      "/home/test/.poe-code/ralph/config.yaml": [
        "agent: codex",
        "maxIterations: 10",
        ""
      ].join("\n"),
      "/repo/.agents/poe-code-ralph/config.yaml": [
        "agent: claude-code",
        ""
      ].join("\n")
    });

    const result = await loadConfig(cwd, { fs: fs as any, homeDir });
    expect(result.config).toEqual({
      agent: "claude-code",
      maxIterations: 10
    });
    expect(result.sources).toEqual([
      { path: "/home/test/.poe-code/ralph/config.yaml", scope: "global" },
      { path: "/repo/.agents/poe-code-ralph/config.yaml", scope: "local" }
    ]);
  });

  it("merges non-overlapping fields from global and local", async () => {
    const cwd = "/repo";
    const homeDir = "/home/test";
    const fs = createMemFs({
      "/home/test/.poe-code/ralph/config.yaml": [
        "agent: claude-code",
        "staleSeconds: 120",
        ""
      ].join("\n"),
      "/repo/.agents/poe-code-ralph/config.yaml": [
        "maxIterations: 5",
        "noCommit: true",
        ""
      ].join("\n")
    });

    const result = await loadConfig(cwd, { fs: fs as any, homeDir });
    expect(result.config).toEqual({
      agent: "claude-code",
      staleSeconds: 120,
      maxIterations: 5,
      noCommit: true
    });
  });

  it("global JSON fallback works", async () => {
    const cwd = "/repo";
    const homeDir = "/home/test";
    const fs = createMemFs({
      "/home/test/.poe-code/ralph/config.json": JSON.stringify({
        agent: "codex",
        maxIterations: 15
      })
    });

    const result = await loadConfig(cwd, { fs: fs as any, homeDir });
    expect(result.config).toEqual({
      agent: "codex",
      maxIterations: 15
    });
    expect(result.sources).toEqual([
      { path: "/home/test/.poe-code/ralph/config.json", scope: "global" }
    ]);
  });

  it("ignores global config when homeDir is not provided", async () => {
    const cwd = "/repo";
    const fs = createMemFs({
      "/repo/.agents/poe-code-ralph/config.yaml": [
        "agent: claude-code",
        ""
      ].join("\n")
    });

    const result = await loadConfig(cwd, { fs: fs as any });
    expect(result.config).toEqual({ agent: "claude-code" });
    expect(result.sources).toEqual([
      { path: "/repo/.agents/poe-code-ralph/config.yaml", scope: "local" }
    ]);
  });
});
