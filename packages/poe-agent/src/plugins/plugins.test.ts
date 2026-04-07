import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { ToolContext } from "../runtime/types.js";
import type { ToolExecutorFileSystem } from "../tool-executor.js";
import { createRunContext } from "../runtime/run-context.js";
import { runAcpCore, type AcpModel } from "../runtime/acp-core.js";
import type { AcpEvent, AcpHost } from "../runtime/types.js";
import { loadSystemPromptSync } from "../system-prompt.js";
import auditLog from "./poe-agent-plugin-audit-log.js";
import environment from "./poe-agent-plugin-environment.js";
import gitContext from "./poe-agent-plugin-git-context.js";
import maxIterations from "./poe-agent-plugin-max-iterations.js";
import scratchpad from "./poe-agent-plugin-scratchpad.js";
import filesPlugin from "./poe-agent-plugin-files.js";
import shellPlugin from "./poe-agent-plugin-shell.js";
import skillsPlugin from "./poe-agent-plugin-skills.js";
import spawnPlugin from "./poe-agent-plugin-spawn.js";
import systemPromptPlugin from "./poe-agent-plugin-system-prompt.js";
import webPlugin from "./poe-agent-plugin-web.js";

const appendFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({
  appendFile: appendFileMock,
}));

const runCommandMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/agent-spawn", () => ({
  runCommand: runCommandMock,
}));

// --- poe-agent-plugin-audit-log ---

describe("poe-agent-plugin-audit-log", () => {
  beforeEach(() => {
    appendFileMock.mockReset();
  });

  it("writes one JSONL record per tool invocation", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    appendFileMock.mockImplementation(fs.appendFile.bind(fs));

    const plugin = auditLog("/audit.jsonl");
    const postToolUse = plugin.hooks?.postToolUse;
    const signal = new AbortController().signal;

    await postToolUse?.({
      tool: "read_file",
      args: { path: "README.md" },
      intentId: "intent-1",
      messages: [],
      signal,
    });
    await postToolUse?.({
      tool: "run_command",
      args: { command: "ls" },
      intentId: "intent-2",
      messages: [],
      signal,
    });

    const lines = volume.readFileSync("/audit.jsonl", "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as { ts: string; tool: string };
    const second = JSON.parse(lines[1]) as { ts: string; tool: string };

    expect(first.tool).toBe("read_file");
    expect(second.tool).toBe("run_command");
    expect(Number.isNaN(Date.parse(first.ts))).toBe(false);
    expect(Number.isNaN(Date.parse(second.ts))).toBe(false);
  });

  it("writes JSONL with only timestamp and tool fields", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    appendFileMock.mockImplementation(fs.appendFile.bind(fs));

    const plugin = auditLog("/audit.jsonl");
    await plugin.hooks?.postToolUse?.({
      tool: "search_web",
      args: { query: "docs" },
      intentId: "intent-3",
      messages: [],
      result: { text: "ok" },
      error: "ignored",
      signal: new AbortController().signal,
    });

    const line = volume.readFileSync("/audit.jsonl", "utf8").trim();
    const record = JSON.parse(line) as Record<string, unknown>;

    expect(Object.keys(record).sort()).toEqual(["tool", "ts"]);
    expect(record.tool).toBe("search_web");
    expect(Number.isNaN(Date.parse(String(record.ts)))).toBe(false);
  });
});

// --- poe-agent-plugin-environment ---

describe("poe-agent-plugin-environment", () => {
  it("adds cwd and node version when system is missing", () => {
    const plugin = environment("/workspace/project");
    const transformed = plugin.prompt?.({
      userPrompt: "x",
    });

    expect(transformed?.system).toBe(
      `Working directory: /workspace/project\nNode: ${process.version}`,
    );
    expect(transformed?.system).toContain("Working directory: /workspace/project");
    expect(transformed?.system).toContain(`Node: ${process.version}`);
    expect(transformed?.system).not.toContain("undefined");
  });

  it("appends cwd and node version to an existing system prompt", () => {
    const plugin = environment("/workspace/project");
    const transformed = plugin.prompt?.({
      userPrompt: "x",
      system: "base-system",
    });

    expect(transformed?.system).toBe(
      `base-system\nWorking directory: /workspace/project\nNode: ${process.version}`,
    );
  });
});

// --- poe-agent-plugin-git-context ---

describe("poe-agent-plugin-git-context", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
  });

  it("adds git status and log to the system prompt", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        stdout: "M README.md\n",
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: "abc1234 feat: plugin hook\n",
        stderr: "",
        exitCode: 0,
      });

    const plugin = gitContext("/workspace/project");
    const transformed = await plugin.prompt?.({
      userPrompt: "x",
      system: "base-system",
    });

    expect(runCommandMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["status", "--short"],
      { cwd: "/workspace/project" },
    );
    expect(runCommandMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["log", "--oneline", "-5"],
      { cwd: "/workspace/project" },
    );

    expect(transformed?.system).toContain("base-system");
    expect(transformed?.system).toContain("## Git context");
    expect(transformed?.system).toContain("M README.md");
    expect(transformed?.system).toContain("abc1234 feat: plugin hook");
  });

  it("keeps git context header when both git commands fail", async () => {
    runCommandMock.mockRejectedValueOnce(new Error("git unavailable")).mockRejectedValueOnce(
      new Error("git unavailable"),
    );

    const plugin = gitContext("/workspace/project");
    const transformed = await plugin.prompt?.({
      userPrompt: "x",
      system: "base-system",
    });

    expect(transformed?.system).toBe("base-system\n## Git context");
    expect(transformed?.system).not.toContain("undefined");
  });

  it("includes whichever git output succeeds", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        stdout: "M README.md\n",
        stderr: "",
        exitCode: 0,
      })
      .mockRejectedValueOnce(new Error("log failed"));

    const plugin = gitContext("/workspace/project");
    const transformed = await plugin.prompt?.({
      userPrompt: "x",
    });

    expect(transformed?.system).toContain("## Git context");
    expect(transformed?.system).toContain("M README.md");
    expect(transformed?.system).not.toContain("undefined");
  });
});

// --- poe-agent-plugin-max-iterations ---

async function collectEvents(events: AsyncIterable<AcpEvent>): Promise<AcpEvent[]> {
  const collected: AcpEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }

  return collected;
}

describe("poe-agent-plugin-max-iterations", () => {
  it("aborts after the configured iteration limit", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(maxIterations(2));

    const host: AcpHost = {
      handle: vi.fn(async () => ({ status: "success", result: "ok" })),
      fork: vi.fn(async request => ({ output: request.prompt, messages: [] })),
      spawn: vi.fn(async prompt => ({ output: prompt, messages: [] })),
    };

    let callCount = 0;
    const model: AcpModel = {
      complete: vi.fn(async () => {
        callCount += 1;
        return {
          message: {
            content: "",
            toolCalls: [
              {
                id: `tool-${callCount}`,
                tool: "always_call_tool",
                args: { iteration: callCount },
              },
            ],
          },
        };
      }),
    };

    const events = await collectEvents(
      runAcpCore({
        prompt: "Always call a tool",
        runContext,
        host,
        model,
      }),
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect((host.handle as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(events.map(event => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "tool.intent",
      "tool.result",
      "session.error",
    ]);

    const terminal = events[events.length - 1];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
      expect(terminal.error.message).toContain("preIteration");
    }
  });

  it("aborts immediately when limit is zero", async () => {
    const runContext = createRunContext();
    runContext.hooks.add(maxIterations(0));

    const host: AcpHost = {
      handle: vi.fn(async () => ({ status: "success", result: "ok" })),
      fork: vi.fn(async request => ({ output: request.prompt, messages: [] })),
      spawn: vi.fn(async prompt => ({ output: prompt, messages: [] })),
    };

    const model: AcpModel = {
      complete: vi.fn(async () => ({
        message: {
          content: "",
          toolCalls: [
            {
              id: "tool-1",
              tool: "always_call_tool",
              args: { iteration: 1 },
            },
          ],
        },
      })),
    };

    const events = await collectEvents(
      runAcpCore({
        prompt: "Always call a tool",
        runContext,
        host,
        model,
      }),
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect((host.handle as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(events).toHaveLength(1);

    const terminal = events[0];
    expect(terminal?.type).toBe("session.error");
    if (terminal?.type === "session.error") {
      expect(terminal.error.name).toBe("AbortError");
      expect(terminal.error.message).toContain("preIteration");
    }
  });
});

// --- poe-agent-plugin-scratchpad ---

const toolContext: ToolContext = {
  fork: async () => ({ output: "unused", messages: [] }),
  spawn: async () => ({ output: "unused", messages: [] }),
  signal: new AbortController().signal,
};

describe("poe-agent-plugin-scratchpad", () => {
  it("roundtrips values between write_note and read_note", async () => {
    const plugin = scratchpad();

    const writeNote = plugin.tools?.find(tool => tool.name === "write_note");
    const readNote = plugin.tools?.find(tool => tool.name === "read_note");

    expect(await writeNote?.call({ key: "todo", value: "ship plugins" }, toolContext)).toBe(
      "Wrote 'todo'",
    );
    expect(await readNote?.call({ key: "todo" }, toolContext)).toBe("ship plugins");
  });

  it("returns default text for missing notes and supports overwriting notes", async () => {
    const plugin = scratchpad();

    const writeNote = plugin.tools?.find(tool => tool.name === "write_note");
    const readNote = plugin.tools?.find(tool => tool.name === "read_note");

    expect(await readNote?.call({ key: "missing" }, toolContext)).toBe("(no note)");

    expect(await writeNote?.call({ key: "todo", value: "draft docs" }, toolContext)).toBe(
      "Wrote 'todo'",
    );
    expect(await writeNote?.call({ key: "todo", value: "publish docs" }, toolContext)).toBe(
      "Wrote 'todo'",
    );
    expect(await readNote?.call({ key: "todo" }, toolContext)).toBe("publish docs");
  });

  it("keeps note state isolated per plugin instance", async () => {
    const first = scratchpad();
    const second = scratchpad();

    const firstWrite = first.tools?.find(tool => tool.name === "write_note");
    const firstRead = first.tools?.find(tool => tool.name === "read_note");
    const secondRead = second.tools?.find(tool => tool.name === "read_note");

    expect(await firstWrite?.call({ key: "project", value: "alpha" }, toolContext)).toBe(
      "Wrote 'project'",
    );
    expect(await firstRead?.call({ key: "project" }, toolContext)).toBe("alpha");
    expect(await secondRead?.call({ key: "project" }, toolContext)).toBe("(no note)");
  });
});

// --- poe-agent built-in plugins ---

function createMemFs(files: Record<string, string> = {}): ToolExecutorFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ToolExecutorFileSystem;
}

const pluginsToolContext: ToolContext = {
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

  return tool.call(args, pluginsToolContext);
}

describe("poe-agent built-in plugins", () => {
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
      system: `${loadSystemPromptSync()}\nuser-system`,
    });
  });

  it("system prompt plugin does not duplicate bundled prompt", () => {
    const plugin = systemPromptPlugin();
    const bundled = loadSystemPromptSync();

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
