import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import memoryPlugin, { spec as memoryPluginSpec } from "./poe-agent-plugin-memory.js";

describe("poe-agent-plugin-memory", () => {
  it("validates config options with its plugin spec", () => {
    expect(
      memoryPluginSpec.parseOptions({
        cwd: "/workspace/project",
        homeDir: "/home/test",
      }),
    ).toEqual({
      cwd: "/workspace/project",
      homeDir: "/home/test",
    });
    expect(() => memoryPluginSpec.parseOptions({ homeDir: 123 })).toThrow();
  });

  it("loads project and user AGENTS.md content with recursive @imports", async () => {
    const volume = Volume.fromJSON(
      {
        "/workspace/AGENTS.md": "Workspace memory",
        "/workspace/project/AGENTS.md": "Project instructions\n@./docs/shared.md",
        "/workspace/project/docs/shared.md": "Shared rules\n@./nested.md",
        "/workspace/project/docs/nested.md": "No TODOs.",
        "/home/test/.config/poe-code/AGENTS.md": "User instructions\n@profiles/base.md",
        "/home/test/.config/poe-code/profiles/base.md": "Be concise.",
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises;
    const plugin = memoryPlugin({
      cwd: "/workspace/project/src/feature",
      homeDir: "/home/test",
      fs,
    });

    const transformed = await plugin.prompt?.({
      userPrompt: "Fix the tests",
      system: "base-system",
    });

    expect(transformed?.system).toBe(
      [
        "Project memory:",
        "Project instructions",
        "Shared rules",
        "No TODOs.",
        "",
        "User memory:",
        "User instructions",
        "Be concise.",
        "",
        "base-system",
      ].join("\n"),
    );
  });

  it("prefers the nearest AGENTS.md when walking up from cwd", async () => {
    const volume = Volume.fromJSON(
      {
        "/workspace/AGENTS.md": "Workspace memory",
        "/workspace/project/AGENTS.md": "Project memory",
      },
      "/",
    );
    const fs = createFsFromVolume(volume).promises;
    const plugin = memoryPlugin({
      cwd: "/workspace/project/packages/poe-agent",
      homeDir: "/home/test",
      fs,
    });

    const transformed = await plugin.prompt?.({
      userPrompt: "Fix the tests",
      system: "base-system",
    });

    expect(transformed?.system).toBe("Project memory:\nProject memory\n\nbase-system");
  });

  it("leaves the prompt unchanged when no AGENTS.md files exist", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    const plugin = memoryPlugin({
      cwd: "/workspace/project",
      homeDir: "/home/test",
      fs,
    });
    const context = {
      userPrompt: "Fix the tests",
      system: "base-system",
    };

    await expect(plugin.prompt?.(context)).resolves.toEqual(context);
  });
});
