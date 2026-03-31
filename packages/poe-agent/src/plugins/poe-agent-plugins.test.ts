import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Volume, createFsFromVolume } from "memfs";
import type { ToolContext } from "../runtime/types.js";
import type { ToolExecutorFileSystem } from "../tool-executor.js";
import * as systemPromptModule from "../system-prompt.js";
import filesPlugin from "./poe-agent-plugin-files.js";
import shellPlugin from "./poe-agent-plugin-shell.js";
import skillsPlugin from "./poe-agent-plugin-skills.js";
import spawnPlugin from "./poe-agent-plugin-spawn.js";
import systemPromptPlugin from "./poe-agent-plugin-system-prompt.js";
import webPlugin from "./poe-agent-plugin-web.js";

function createMemFs(files: Record<string, string> = {}): ToolExecutorFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ToolExecutorFileSystem;
}

const toolContext: ToolContext = {
  fork: async () => {
    throw new Error("fork is not supported in plugin tests");
  },
  spawn: async () => {
    throw new Error("spawn is not supported in plugin tests");
  },
  signal: new AbortController().signal,
};

async function callToolByName(
  pluginTools: Array<{ name: string; call: (args: unknown, ctx: ToolContext) => unknown | Promise<unknown> }>,
  name: string,
  args: unknown,
): Promise<unknown> {
  const tool = pluginTools.find(candidate => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  return tool.call(args, toolContext);
}

describe("poe-agent built-in plugins", () => {
  let loadSystemPromptSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loadSystemPromptSpy = vi
      .spyOn(systemPromptModule, "loadSystemPromptSync")
      .mockReturnValue("Bundled system prompt");
  });

  afterEach(() => {
    loadSystemPromptSpy.mockRestore();
  });

  it("system prompt plugin prepends bundled prompt", () => {
    const plugin = systemPromptPlugin();

    expect(plugin.name).toBe("poe-agent-plugin-system-prompt");
    expect(plugin.prompt).toBeTypeOf("function");

    const transformed = plugin.prompt?.({
      userPrompt: "hello",
      system: "user-system",
    });

    expect(transformed).toEqual({
      userPrompt: "hello",
      system: "Bundled system prompt\nuser-system",
    });
  });

  it("system prompt plugin does not duplicate bundled prompt", () => {
    const plugin = systemPromptPlugin();
    const bundled = "Bundled system prompt";

    const transformed = plugin.prompt?.({
      userPrompt: "hello",
      baseSystemPrompt: bundled,
      system: bundled,
    });

    expect(transformed).toEqual({
      userPrompt: "hello",
      baseSystemPrompt: bundled,
      system: bundled,
    });
  });

  it("files plugin exposes read/edit/list tools and preserves behavior", async () => {
    const fs = createMemFs({
      "/workspace/project/README.md": "hello",
      "/workspace/project/app.ts": "const x = 1;\n",
    });
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
    });

    expect(plugin.name).toBe("poe-agent-plugin-files");
    expect(plugin.tools?.map(tool => tool.name)).toEqual(["read_file", "edit_file", "list_files"]);

    await expect(callToolByName(plugin.tools ?? [], "read_file", { path: "README.md" })).resolves.toBe(
      "hello",
    );

    await expect(
      callToolByName(plugin.tools ?? [], "edit_file", {
        command: "str_replace",
        path: "app.ts",
        old_str: "const x = 1;",
        new_str: "const x = 42;",
      }),
    ).resolves.toBe("Edited file: app.ts");

    await expect(callToolByName(plugin.tools ?? [], "read_file", { path: "app.ts" })).resolves.toBe(
      "const x = 42;\n",
    );

    await expect(callToolByName(plugin.tools ?? [], "list_files", {})).resolves.toBe("app.ts\nREADME.md");
  });

  it("shell plugin resolves cwd and delegates to provided runner", async () => {
    const runCommand = vi.fn(async () => "ok");
    const plugin = shellPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      runCommand,
    });

    expect(plugin.name).toBe("poe-agent-plugin-shell");
    expect(plugin.tools?.map(tool => tool.name)).toEqual(["run_command"]);

    await expect(
      callToolByName(plugin.tools ?? [], "run_command", { command: "ls -la", cwd: "./subdir" }),
    ).resolves.toBe("ok");

    expect(runCommand).toHaveBeenCalledWith("ls -la", "/workspace/project/subdir");
  });

  it("web plugin delegates to provided search implementation", async () => {
    const searchWeb = vi.fn(async () => "results");
    const plugin = webPlugin({ searchWeb });

    expect(plugin.name).toBe("poe-agent-plugin-web");
    expect(plugin.tools?.map(tool => tool.name)).toEqual(["search_web"]);

    await expect(callToolByName(plugin.tools ?? [], "search_web", { query: "poe" })).resolves.toBe(
      "results",
    );
    expect(searchWeb).toHaveBeenCalledWith("poe");
  });

  it("spawn plugin exposes spawn tool that calls ctx.spawn(task)", async () => {
    const spawn = vi.fn(async () => ({ output: "spawned", messages: [] }));
    const fork = vi.fn(async () => ({ output: "forked", messages: [] }));
    const plugin = spawnPlugin();
    const spawnContext: ToolContext = {
      spawn,
      fork,
      signal: new AbortController().signal,
    };

    expect(plugin.name).toBe("spawn");
    expect(plugin.tools?.map(tool => tool.name)).toEqual(["spawn"]);

    const tool = plugin.tools?.[0];
    await expect(tool?.call({ task: "investigate tests" }, spawnContext)).resolves.toEqual({
      output: "spawned",
      messages: [],
    });
    expect(spawn).toHaveBeenCalledWith("investigate tests");
    expect(fork).not.toHaveBeenCalled();
  });

  it("skills plugin reads options.skills at prompt time and injects active-skill guidance", async () => {
    let runtimeSkills = ["repo"];
    const getActiveTools = vi.fn((activeSkills?: string[]) => {
      if (activeSkills?.includes("repo")) {
        return [{ name: "repo.search" }];
      }

      return [];
    });

    const plugin = skillsPlugin({
      definitions: {
        repo: {
          tools: ["repo.search", "repo.open"],
          tags: ["code", "git"],
        },
      },
      skills: () => runtimeSkills,
      toolRegistry: {
        getActiveTools,
      },
    });

    const first = await plugin.prompt?.({
      userPrompt: "Investigate the regression",
      system: "Base system",
    });
    expect(first?.system).toContain("Active skills: repo");
    expect(first?.system).toContain("repo.search");
    expect(first?.system).toContain("code");
    expect(first?.system).toContain("repo.search");
    expect(first?.metadata).toEqual(
      expect.objectContaining({
        skills: {
          active: ["repo"],
          tools: ["repo.search"],
        },
      }),
    );

    runtimeSkills = ["unknown"];
    const second = await plugin.prompt?.({
      userPrompt: "Investigate the regression",
      system: "Base system",
    });
    expect(second?.system).toBe("Base system");
    expect(getActiveTools).toHaveBeenCalledWith(["repo"]);
    expect(getActiveTools).toHaveBeenCalledWith(["unknown"]);
  });
});
