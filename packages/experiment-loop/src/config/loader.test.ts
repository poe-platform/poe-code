import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { loadRunConfig } from "./loader.js";
import type { ExperimentFileSystem } from "../types.js";

function createFs(files: Record<string, string> = {}): ExperimentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
}

describe("loadRunConfig", () => {
  it("returns default prompt template when no run.yaml exists", async () => {
    const config = await loadRunConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs()
    });

    expect(config.prompt).toContain("{{body}}");
    expect(config.prompt).toContain("{{journal}}");
    expect(config.prompt).toContain("{{metrics}}");
    expect(config.prompt).toContain("{{crash_output}}");
  });

  it("loads project run.yaml", async () => {
    const config = await loadRunConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/experiments/run.yaml": [
          "prompt: |",
          "  Do this: {{body}}",
          "  History: {{journal}}",
          ""
        ].join("\n")
      })
    });

    expect(config.prompt).toBe("Do this: {{body}}\nHistory: {{journal}}\n");
  });

  it("loads global run.yaml when no project file exists", async () => {
    const config = await loadRunConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/experiments/run.yaml": [
          "prompt: |",
          "  Global: {{body}}",
          ""
        ].join("\n")
      })
    });

    expect(config.prompt).toBe("Global: {{body}}\n");
  });

  it("project run.yaml takes precedence over global", async () => {
    const config = await loadRunConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/experiments/run.yaml": [
          "prompt: |",
          "  Global: {{body}}",
          ""
        ].join("\n"),
        "/repo/.poe-code/experiments/run.yaml": [
          "prompt: |",
          "  Project: {{body}}",
          ""
        ].join("\n")
      })
    });

    expect(config.prompt).toBe("Project: {{body}}\n");
  });

  it("returns default when run.yaml is comment-only", async () => {
    const config = await loadRunConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/experiments/run.yaml": [
          "# This file is all comments",
          "# No actual config",
          ""
        ].join("\n")
      })
    });

    expect(config.prompt).toContain("{{body}}");
  });

  it("throws for invalid yaml", async () => {
    await expect(
      loadRunConfig({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/experiments/run.yaml": "prompt: ["
        })
      })
    ).rejects.toThrow(/invalid.*yaml/i);
  });

  it("throws when prompt field is missing", async () => {
    await expect(
      loadRunConfig({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/experiments/run.yaml": "other: value\n"
        })
      })
    ).rejects.toThrow(/missing.*prompt/i);
  });

  it("throws when prompt field is not a string", async () => {
    await expect(
      loadRunConfig({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/experiments/run.yaml": "prompt: 42\n"
        })
      })
    ).rejects.toThrow(/prompt.*string/i);
  });
});
