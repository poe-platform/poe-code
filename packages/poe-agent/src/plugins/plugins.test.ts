import { beforeEach, describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { ToolContext } from "../runtime/types.js";
import type { ToolExecutorFileSystem } from "../tool-executor.js";
import { createRunContext } from "../runtime/run-context.js";
import { runAcpCore, type AcpModel } from "../runtime/acp-core.js";
import { toAcpModelResponse } from "../testing/model-response.js";
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
import systemPromptPlugin, {
  spec as systemPromptPluginSpec
} from "./poe-agent-plugin-system-prompt.js";
import webPlugin from "./poe-agent-plugin-web.js";

const appendFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  appendFile: appendFileMock
}));

const runCommandMock = vi.hoisted(() => vi.fn());

vi.mock("@poe-code/agent-spawn", () => ({
  runCommand: runCommandMock
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

    const plugin = auditLog("/audit.jsonl", fs);
    const postToolUse = plugin.hooks?.postToolUse;
    const signal = new AbortController().signal;

    await postToolUse?.({
      tool: "read_file",
      args: { path: "README.md" },
      intentId: "intent-1",
      messages: [],
      signal
    });
    await postToolUse?.({
      tool: "run_command",
      args: { command: "ls" },
      intentId: "intent-2",
      messages: [],
      signal
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

    const plugin = auditLog("/audit.jsonl", fs);
    await plugin.hooks?.postToolUse?.({
      tool: "search_web",
      args: { query: "docs" },
      intentId: "intent-3",
      messages: [],
      result: { text: "ok" },
      error: "ignored",
      signal: new AbortController().signal
    });

    const line = volume.readFileSync("/audit.jsonl", "utf8").trim();
    const record = JSON.parse(line) as Record<string, unknown>;

    expect(Object.keys(record).sort()).toEqual(["tool", "ts"]);
    expect(record.tool).toBe("search_web");
    expect(Number.isNaN(Date.parse(String(record.ts)))).toBe(false);
  });

  it("writes compaction summaries with dropped message counts", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    appendFileMock.mockImplementation(fs.appendFile.bind(fs));

    const plugin = auditLog("/audit.jsonl", fs);
    await plugin.hooks?.postCompaction?.({
      tokenCount: 42,
      summary: "Kept the open bug and latest file edits.",
      droppedMessages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" }
      ],
      messages: [{ role: "system", content: "Compacted context summary:\n..." }],
      signal: new AbortController().signal
    });

    const line = volume.readFileSync("/audit.jsonl", "utf8").trim();
    const record = JSON.parse(line) as Record<string, unknown>;

    expect(record).toMatchObject({
      event: "compaction",
      summary: "Kept the open bug and latest file edits.",
      droppedMessageCount: 2
    });
    expect(Number.isNaN(Date.parse(String(record.ts)))).toBe(false);
  });

  it("does not append audit events through a symlinked log file", async () => {
    const volume = Volume.fromJSON({
      "/outside/audit.jsonl": "original\n"
    }, "/");
    volume.mkdirSync("/project/logs", { recursive: true });
    volume.symlinkSync("/outside/audit.jsonl", "/project/logs/audit.jsonl");
    const fs = createFsFromVolume(volume).promises;
    const plugin = auditLog("/project/logs/audit.jsonl", fs);

    await expect(
      plugin.hooks?.postToolUse?.({
        tool: "read_file",
        args: { path: "README.md" },
        intentId: "intent-1",
        messages: [],
        signal: new AbortController().signal
      })
    ).rejects.toThrow("Path may not contain symbolic links");

    expect(volume.readFileSync("/outside/audit.jsonl", "utf8")).toBe("original\n");
  });

  it("does not fail completed tool work when audit append persistence fails", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    const appendFailureFs = {
      ...fs,
      appendFile: vi.fn(async () => {
        throw new Error("audit disk full");
      })
    };
    const plugin = auditLog("/audit.jsonl", appendFailureFs as never);

    await expect(
      plugin.hooks?.postToolUse?.({
        tool: "edit_file",
        args: { path: "src/app.ts" },
        intentId: "intent-1",
        messages: [],
        result: "changed workspace",
        signal: new AbortController().signal
      })
    ).resolves.toBeUndefined();
  });
});

// --- poe-agent-plugin-environment ---

describe("poe-agent-plugin-system-prompt", () => {
  it("validates config options with its plugin spec", () => {
    expect(systemPromptPluginSpec.parseOptions({})).toEqual({});
    expect(() => systemPromptPluginSpec.parseOptions({ enabled: true })).toThrow();
  });
});

describe("poe-agent-plugin-environment", () => {
  it("adds cwd and node version when system is missing", () => {
    const plugin = environment("/workspace/project");
    const transformed = plugin.prompt?.({
      userPrompt: "x"
    });

    expect(transformed?.system).toBe(
      `Working directory: /workspace/project\nNode: ${process.version}`
    );
    expect(transformed?.system).toContain("Working directory: /workspace/project");
    expect(transformed?.system).toContain(`Node: ${process.version}`);
    expect(transformed?.system).not.toContain("undefined");
  });

  it("appends cwd and node version to an existing system prompt", () => {
    const plugin = environment("/workspace/project");
    const transformed = plugin.prompt?.({
      userPrompt: "x",
      system: "base-system"
    });

    expect(transformed?.system).toBe(
      `base-system\nWorking directory: /workspace/project\nNode: ${process.version}`
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
        exitCode: 0
      })
      .mockResolvedValueOnce({
        stdout: "abc1234 feat: plugin hook\n",
        stderr: "",
        exitCode: 0
      });

    const plugin = gitContext("/workspace/project");
    const transformed = await plugin.prompt?.({
      userPrompt: "x",
      system: "base-system"
    });

    expect(runCommandMock).toHaveBeenNthCalledWith(1, "git", ["status", "--short"], {
      cwd: "/workspace/project"
    });
    expect(runCommandMock).toHaveBeenNthCalledWith(2, "git", ["log", "--oneline", "-5"], {
      cwd: "/workspace/project"
    });

    expect(transformed?.system).toContain("base-system");
    expect(transformed?.system).toContain("## Git context");
    expect(transformed?.system).toContain("M README.md");
    expect(transformed?.system).toContain("abc1234 feat: plugin hook");
  });

  it("keeps git context header when both git commands fail", async () => {
    runCommandMock
      .mockRejectedValueOnce(new Error("git unavailable"))
      .mockRejectedValueOnce(new Error("git unavailable"));

    const plugin = gitContext("/workspace/project");
    const transformed = await plugin.prompt?.({
      userPrompt: "x",
      system: "base-system"
    });

    expect(transformed?.system).toBe("base-system\n## Git context");
    expect(transformed?.system).not.toContain("undefined");
  });

  it("includes whichever git output succeeds", async () => {
    runCommandMock
      .mockResolvedValueOnce({
        stdout: "M README.md\n",
        stderr: "",
        exitCode: 0
      })
      .mockRejectedValueOnce(new Error("log failed"));

    const plugin = gitContext("/workspace/project");
    const transformed = await plugin.prompt?.({
      userPrompt: "x"
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
      fork: vi.fn(async (request) => ({ output: request.prompt, messages: [] })),
      spawn: vi.fn(async (prompt) => ({ output: prompt, messages: [] }))
    };

    let callCount = 0;
    const model: AcpModel = {
      complete: vi.fn(async () => {
        callCount += 1;
        return toAcpModelResponse({
          message: {
            content: "",
            toolCalls: [
              {
                id: `tool-${callCount}`,
                tool: "always_call_tool",
                args: { iteration: callCount }
              }
            ]
          }
        });
      })
    };

    const events = await collectEvents(
      runAcpCore({
        prompt: "Always call a tool",
        runContext,
        host,
        model
      })
    );

    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect((host.handle as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual([
      "tool.intent",
      "tool.result",
      "tool.intent",
      "tool.result",
      "session.error"
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
      fork: vi.fn(async (request) => ({ output: request.prompt, messages: [] })),
      spawn: vi.fn(async (prompt) => ({ output: prompt, messages: [] }))
    };

    const model: AcpModel = {
      complete: vi.fn(async () =>
        toAcpModelResponse({
          message: {
            content: "",
            toolCalls: [
              {
                id: "tool-1",
                tool: "always_call_tool",
                args: { iteration: 1 }
              }
            ]
          }
        })
      )
    };

    const events = await collectEvents(
      runAcpCore({
        prompt: "Always call a tool",
        runContext,
        host,
        model
      })
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

  it("does not leak iteration state across runs", async () => {
    const plugin = maxIterations(1);

    const createEvents = async (): Promise<AcpEvent[]> => {
      const runContext = createRunContext();
      runContext.hooks.add(plugin);

      const host: AcpHost = {
        handle: vi.fn(async () => ({ status: "success", result: "ok" })),
        fork: vi.fn(async (request) => ({ output: request.prompt, messages: [] })),
        spawn: vi.fn(async (prompt) => ({ output: prompt, messages: [] }))
      };

      let callCount = 0;
      const model: AcpModel = {
        complete: vi.fn(async () => {
          callCount += 1;
          return toAcpModelResponse({
            message: {
              content: "",
              toolCalls: [
                {
                  id: `tool-${callCount}`,
                  tool: "always_call_tool",
                  args: { iteration: callCount }
                }
              ]
            }
          });
        })
      };

      return collectEvents(
        runAcpCore({
          prompt: "Always call a tool",
          runContext,
          host,
          model
        })
      );
    };

    const firstRunEvents = await createEvents();
    const secondRunEvents = await createEvents();

    for (const events of [firstRunEvents, secondRunEvents]) {
      expect(events.map((event) => event.type)).toEqual([
        "tool.intent",
        "tool.result",
        "session.error"
      ]);

      const terminal = events[events.length - 1];
      expect(terminal?.type).toBe("session.error");
      if (terminal?.type === "session.error") {
        expect(terminal.error.name).toBe("AbortError");
        expect(terminal.error.message).toContain("preIteration");
      }
    }
  });
});

// --- poe-agent-plugin-scratchpad ---

const toolContext: ToolContext = {
  fork: async () => ({ output: "unused", messages: [] }),
  spawn: async () => ({ output: "unused", messages: [] }),
  signal: new AbortController().signal
};

describe("poe-agent-plugin-scratchpad", () => {
  it("roundtrips values between write_note and read_note", async () => {
    const plugin = scratchpad();

    const writeNote = plugin.tools?.find((tool) => tool.name === "write_note");
    const readNote = plugin.tools?.find((tool) => tool.name === "read_note");

    expect(await writeNote?.call({ key: "todo", value: "ship plugins" }, toolContext)).toBe(
      "Wrote 'todo'"
    );
    expect(await readNote?.call({ key: "todo" }, toolContext)).toBe("ship plugins");
  });

  it("returns default text for missing notes and supports overwriting notes", async () => {
    const plugin = scratchpad();

    const writeNote = plugin.tools?.find((tool) => tool.name === "write_note");
    const readNote = plugin.tools?.find((tool) => tool.name === "read_note");

    expect(await readNote?.call({ key: "missing" }, toolContext)).toBe("(no note)");

    expect(await writeNote?.call({ key: "todo", value: "draft docs" }, toolContext)).toBe(
      "Wrote 'todo'"
    );
    expect(await writeNote?.call({ key: "todo", value: "publish docs" }, toolContext)).toBe(
      "Wrote 'todo'"
    );
    expect(await readNote?.call({ key: "todo" }, toolContext)).toBe("publish docs");
  });

  it("keeps note state isolated per plugin instance", async () => {
    const first = scratchpad();
    const second = scratchpad();

    const firstWrite = first.tools?.find((tool) => tool.name === "write_note");
    const firstRead = first.tools?.find((tool) => tool.name === "read_note");
    const secondRead = second.tools?.find((tool) => tool.name === "read_note");

    expect(await firstWrite?.call({ key: "project", value: "alpha" }, toolContext)).toBe(
      "Wrote 'project'"
    );
    expect(await firstRead?.call({ key: "project" }, toolContext)).toBe("alpha");
    expect(await secondRead?.call({ key: "project" }, toolContext)).toBe("(no note)");
  });

  it("declares input schemas and rejects invalid note arguments", async () => {
    const plugin = scratchpad();

    const writeNote = plugin.tools?.find((tool) => tool.name === "write_note");
    const readNote = plugin.tools?.find((tool) => tool.name === "read_note");

    expect(writeNote?.inputSchema).toEqual({
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string" }
      },
      required: ["key", "value"],
      additionalProperties: false
    });
    expect(readNote?.inputSchema).toEqual({
      type: "object",
      properties: {
        key: { type: "string" }
      },
      required: ["key"],
      additionalProperties: false
    });

    expect(() => writeNote?.call({ value: "missing key" }, toolContext)).toThrow(
      "write_note requires string key and value"
    );
    expect(() => readNote?.call({ key: 123 }, toolContext)).toThrow("read_note requires a string key");
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
  signal: new AbortController().signal
};

async function callToolByName(
  pluginTools: Array<{
    name: string;
    call: (args: unknown, ctx: ToolContext) => unknown | Promise<unknown>;
  }>,
  name: string,
  args: unknown,
  ctx: ToolContext = pluginsToolContext
): Promise<unknown> {
  const tool = pluginTools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  return tool.call(args, ctx);
}

function createNodeCommand(code: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`;
}

async function waitForBackgroundOutput(
  plugin: {
    tools?: Array<{
      name: string;
      call: (args: unknown, ctx: ToolContext) => unknown | Promise<unknown>;
    }>;
  },
  handle: string,
  expectedOutput: string
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const output = await callToolByName(plugin.tools ?? [], "read_background", { handle });
    if (typeof output === "string" && output.includes(expectedOutput)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for background output: ${expectedOutput}`);
}

describe("poe-agent built-in plugins", () => {
  it("system prompt plugin prepends bundled prompt", () => {
    const plugin = systemPromptPlugin();

    expect(plugin.name).toBe("poe-agent-plugin-system-prompt");
    expect(plugin.prompt).toBeTypeOf("function");

    const transformed = plugin.prompt?.({
      userPrompt: "hello",
      system: "user-system"
    });

    expect(transformed).toEqual({
      userPrompt: "hello",
      system: `${loadSystemPromptSync()}\nuser-system`
    });
  });

  it("system prompt plugin does not duplicate bundled prompt", () => {
    const plugin = systemPromptPlugin();
    const bundled = loadSystemPromptSync();

    const transformed = plugin.prompt?.({
      userPrompt: "hello",
      baseSystemPrompt: bundled,
      system: bundled
    });

    expect(transformed).toEqual({
      userPrompt: "hello",
      baseSystemPrompt: bundled,
      system: bundled
    });
  });

  it("files plugin exposes read/edit/list tools and preserves behavior", async () => {
    const fs = createMemFs({
      "/workspace/project/README.md": "hello",
      "/workspace/project/app.ts": "const x = 1;\n"
    });
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs
    });

    expect(plugin.name).toBe("poe-agent-plugin-files");
    expect(plugin.tools?.map((tool) => tool.name)).toEqual([
      "read_file",
      "edit_file",
      "list_files",
      "grep",
      "glob"
    ]);

    await expect(
      callToolByName(plugin.tools ?? [], "read_file", { path: "README.md" })
    ).resolves.toBe("hello");

    await expect(
      callToolByName(plugin.tools ?? [], "edit_file", {
        command: "str_replace",
        path: "app.ts",
        old_str: "const x = 1;",
        new_str: "const x = 42;"
      })
    ).resolves.toBe("Edited file: app.ts");

    await expect(callToolByName(plugin.tools ?? [], "read_file", { path: "app.ts" })).resolves.toBe(
      "const x = 42;\n"
    );

    await expect(callToolByName(plugin.tools ?? [], "list_files", {})).resolves.toBe(
      "app.ts\nREADME.md"
    );
  });

  it("files plugin grep delegates to the provided search implementation", async () => {
    const searchContent = vi.fn(async () => "src/app.ts:2:const value = 1;");
    const fs = createFsFromVolume(
      Volume.fromJSON(
        {
          "/workspace/project/src/app.ts": "const value = 1;\n"
        },
        "/"
      )
    ).promises;
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
      searchContent
    });
    const signal = new AbortController().signal;

    await expect(
      callToolByName(
        plugin.tools ?? [],
        "grep",
        {
          pattern: "value",
          path: "src",
          glob: "*.ts",
          output_mode: "content",
          line_numbers: true,
          ignore_case: true
        },
        { ...pluginsToolContext, signal }
      )
    ).resolves.toBe("src/app.ts:2:const value = 1;");

    expect(searchContent).toHaveBeenCalledWith({
      pattern: "value",
      path: "/workspace/project/src",
      glob: "*.ts",
      outputMode: "content",
      lineNumbers: true,
      ignoreCase: true,
      signal
    });
  });

  it("files plugin glob returns matches sorted by modified time descending", async () => {
    const volume = Volume.fromJSON(
      {
        "/workspace/project/src/alpha.ts": "export const alpha = 1;\n",
        "/workspace/project/src/beta.ts": "export const beta = 2;\n"
      },
      "/"
    );
    volume.utimesSync("/workspace/project/src/alpha.ts", new Date(1_000), new Date(1_000));
    volume.utimesSync("/workspace/project/src/beta.ts", new Date(2_000), new Date(2_000));

    const fs = createFsFromVolume(volume).promises;
    const globFiles = vi.fn(async () => [
      "/workspace/project/src/alpha.ts",
      "/workspace/project/src/beta.ts"
    ]);
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs,
      globFiles
    });

    await expect(
      callToolByName(plugin.tools ?? [], "glob", {
        pattern: "**/*.ts",
        path: "src"
      })
    ).resolves.toBe("src/beta.ts\nsrc/alpha.ts");

    expect(globFiles).toHaveBeenCalledWith({
      pattern: "**/*.ts",
      cwd: "/workspace/project/src"
    });
  });

  it("files plugin supports line-based read_file offset and limit", async () => {
    const fs = createMemFs({
      "/workspace/project/notes.md": "zero\none\ntwo\nthree\n"
    });
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs
    });

    await expect(
      callToolByName(plugin.tools ?? [], "read_file", {
        path: "notes.md",
        offset: 1,
        limit: 2
      })
    ).resolves.toBe("one\ntwo\n");

    await expect(
      callToolByName(plugin.tools ?? [], "read_file", {
        path: "notes.md",
        offset: 3
      })
    ).resolves.toBe("three\n");
  });

  it("files plugin returns image tool results for image files", async () => {
    const volume = Volume.fromJSON({}, "/");
    volume.mkdirSync("/workspace/project", { recursive: true });
    volume.writeFileSync("/workspace/project/diagram.png", Buffer.from("png-binary"));
    const fs = createFsFromVolume(volume).promises as unknown as ToolExecutorFileSystem;
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs
    });

    await expect(
      callToolByName(plugin.tools ?? [], "read_file", { path: "diagram.png" })
    ).resolves.toEqual({
      type: "image",
      mimeType: "image/png",
      data: Buffer.from("png-binary").toString("base64")
    });
  });

  it("files plugin supports edit_file replace_all and overwrite", async () => {
    const fs = createMemFs({
      "/workspace/project/app.ts": "const value = 1;\nconst value = 1;\n"
    });
    const plugin = filesPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      fs
    });

    await expect(
      callToolByName(plugin.tools ?? [], "edit_file", {
        command: "str_replace",
        path: "app.ts",
        old_str: "const value = 1;",
        new_str: "const value = 2;"
      })
    ).rejects.toThrow("old_str appears 2 times");

    await expect(
      callToolByName(plugin.tools ?? [], "edit_file", {
        command: "str_replace",
        path: "app.ts",
        old_str: "const value = 1;",
        new_str: "const value = 2;",
        replace_all: true
      })
    ).resolves.toBe("Edited file: app.ts");

    await expect(callToolByName(plugin.tools ?? [], "read_file", { path: "app.ts" })).resolves.toBe(
      "const value = 2;\nconst value = 2;\n"
    );

    await expect(
      callToolByName(plugin.tools ?? [], "edit_file", {
        command: "overwrite",
        path: "app.ts",
        file_text: "export const value = 3;\n"
      })
    ).resolves.toBe("Overwrote file: app.ts");

    await expect(callToolByName(plugin.tools ?? [], "read_file", { path: "app.ts" })).resolves.toBe(
      "export const value = 3;\n"
    );
  });

  it("shell plugin resolves cwd and delegates to provided runner", async () => {
    const signal = new AbortController().signal;
    const runCommand = vi.fn(async () => "ok");
    const plugin = shellPlugin({
      cwd: "/workspace/project",
      allowedPaths: ["/workspace/project"],
      runCommand
    });

    expect(plugin.name).toBe("poe-agent-plugin-shell");
    expect(plugin.tools?.map((tool) => tool.name)).toEqual([
      "run_command",
      "read_background",
      "kill_background"
    ]);

    await expect(
      plugin.tools?.[0]?.call(
        { command: "ls -la", cwd: "./subdir", timeout: 45 },
        {
          ...pluginsToolContext,
          signal
        }
      )
    ).resolves.toBe("ok");

    expect(runCommand).toHaveBeenCalledWith("ls -la", "/workspace/project/subdir", {
      signal,
      timeoutMs: 45_000
    });
  });

  it("shell plugin starts background commands, reads buffered output, and kills them", async () => {
    const cwd = process.cwd();
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });

    const handle = await callToolByName(plugin.tools ?? [], "run_command", {
      command: createNodeCommand("process.stdout.write('ready\\n'); setInterval(() => {}, 1_000);"),
      run_in_background: true
    });

    expect(handle).toBeTypeOf("string");

    await waitForBackgroundOutput(plugin, String(handle), "ready");

    await expect(
      callToolByName(plugin.tools ?? [], "kill_background", {
        handle
      })
    ).resolves.toBe(`Killed background command: ${handle}`);

    await expect(
      callToolByName(plugin.tools ?? [], "read_background", {
        handle
      })
    ).resolves.toContain("Status: exited");
  });

  it("shell plugin times out foreground commands", async () => {
    const cwd = process.cwd();
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });

    await expect(
      callToolByName(plugin.tools ?? [], "run_command", {
        command: createNodeCommand("setTimeout(() => {}, 5_000);"),
        timeout: 0.05
      })
    ).rejects.toThrow("Command timed out after 0.05 seconds");
  });

  it("shell plugin aborts foreground commands when the tool signal is aborted", async () => {
    const cwd = process.cwd();
    const plugin = shellPlugin({
      cwd,
      allowedPaths: [cwd]
    });
    const runCommandTool = plugin.tools?.find((tool) => tool.name === "run_command");
    const controller = new AbortController();
    const callPromise = runCommandTool?.call(
      {
        command: createNodeCommand("setTimeout(() => {}, 5_000);")
      },
      {
        ...pluginsToolContext,
        signal: controller.signal
      }
    );

    controller.abort(new Error("stop"));

    await expect(callPromise).rejects.toThrow("Command aborted");
  });

  it("web plugin delegates to provided search implementation", async () => {
    const searchWeb = vi.fn(async () => "results");
    const plugin = webPlugin({ searchWeb });

    expect(plugin.name).toBe("poe-agent-plugin-web");
    expect(plugin.tools?.map((tool) => tool.name)).toEqual(["search_web", "fetch_url"]);

    await expect(callToolByName(plugin.tools ?? [], "search_web", { query: "poe" })).resolves.toBe(
      "results"
    );
    expect(searchWeb).toHaveBeenCalledWith("poe", {
      signal: pluginsToolContext.signal
    });
  });

  it("web plugin fetch_url converts HTML responses to markdown", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          "<html><body><h1>Example</h1><p>Hello <strong>world</strong>.</p></body></html>",
          {
            headers: {
              "content-type": "text/html; charset=utf-8"
            }
          }
        )
    );
    const plugin = webPlugin({ fetch: fetchMock });

    const output = await callToolByName(plugin.tools ?? [], "fetch_url", {
      url: "https://example.com/docs"
    });

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/docs", {
      signal: pluginsToolContext.signal
    });
    expect(output).toContain("URL: https://example.com/docs");
    expect(output).toContain("Content type: text/html");
    expect(output).toContain("# Example");
    expect(output).toContain("Hello **world**.");
    expect(output).toContain("Showing characters 0-");
    expect(output).not.toContain("More content available");
  });

  it("web plugin fetch_url paginates long response bodies with offset", async () => {
    const body = "0123456789".repeat(2_500);
    const fetchMock = vi.fn(
      async () =>
        new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8"
          }
        })
    );
    const plugin = webPlugin({ fetch: fetchMock });

    const firstPage = await callToolByName(plugin.tools ?? [], "fetch_url", {
      url: "https://example.com/log"
    });
    const secondPage = await callToolByName(plugin.tools ?? [], "fetch_url", {
      url: "https://example.com/log",
      offset: 20_000
    });

    expect(firstPage).toContain("Showing characters 0-20000 of 25000.");
    expect(firstPage).toContain("More content available at offset 20000.");
    expect(firstPage).toContain("0123456789");
    expect(secondPage).toContain("Showing characters 20000-25000 of 25000.");
    expect(secondPage).not.toContain("More content available");
    expect(secondPage).toContain("0123456789");
  });

  it("web plugin fetch_url aborts when ctx.signal fires", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );
    const plugin = webPlugin({ fetch: fetchMock });

    const tool = plugin.tools?.find((candidate) => candidate.name === "fetch_url");
    if (!tool) {
      throw new Error("fetch_url tool not found");
    }

    const pending = tool.call(
      { url: "https://example.com" },
      { ...pluginsToolContext, signal: controller.signal }
    );

    controller.abort();

    await expect(pending).rejects.toThrow("Aborted");
  });

  it("spawn plugin exposes spawn tool that calls ctx.spawn(task)", async () => {
    const spawn = vi.fn(async () => ({ output: "spawned", messages: [] }));
    const fork = vi.fn(async () => ({ output: "forked", messages: [] }));
    const plugin = spawnPlugin();
    const spawnContext: ToolContext = {
      spawn,
      fork,
      signal: new AbortController().signal
    };

    expect(plugin.name).toBe("spawn");
    expect(plugin.tools?.map((tool) => tool.name)).toEqual(["spawn"]);

    const tool = plugin.tools?.[0];
    await expect(tool?.call({ task: "investigate tests" }, spawnContext)).resolves.toEqual(
      "spawned"
    );
    expect(spawn).toHaveBeenCalledWith("investigate tests");
    expect(fork).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'Tool argument "task" must be a string'],
    [{ task: 123 }, 'Tool argument "task" must be a string'],
    [{ task: "" }, 'Tool argument "task" must not be empty'],
    [{ task: "   " }, 'Tool argument "task" must not be empty']
  ])("spawn plugin rejects invalid task argument %#", async (args, expectedError) => {
    const spawn = vi.fn(async () => ({ output: "spawned", messages: [] }));
    const fork = vi.fn(async () => ({ output: "forked", messages: [] }));
    const plugin = spawnPlugin();
    const spawnContext: ToolContext = {
      spawn,
      fork,
      signal: new AbortController().signal
    };

    const tool = plugin.tools?.[0];
    await expect(tool?.call(args, spawnContext)).rejects.toThrow(expectedError);
    expect(spawn).not.toHaveBeenCalled();
    expect(fork).not.toHaveBeenCalled();
  });

  it("skills plugin reads options.skills at prompt time and injects active-skill guidance", async () => {
    let runtimeSkills = ["repo"];
    const getActiveTools = vi.fn((activeSkills?: string[]) => {
      if (activeSkills?.includes("repo")) {
        return [{ name: "repo_search" }];
      }

      return [];
    });

    const plugin = skillsPlugin({
      definitions: {
        repo: {
          tools: ["repo_search", "repo_open"],
          tags: ["code", "git"]
        }
      },
      skills: () => runtimeSkills,
      toolRegistry: {
        getActiveTools
      }
    });

    const first = await plugin.prompt?.({
      userPrompt: "Investigate the regression",
      system: "Base system"
    });
    expect(first?.system).toContain("Active skills: repo");
    expect(first?.system).toContain("repo_search");
    expect(first?.system).toContain("code");
    expect(first?.system).toContain("repo_search");
    expect(first?.metadata).toEqual(
      expect.objectContaining({
        skills: {
          active: ["repo"],
          tools: ["repo_search"]
        }
      })
    );

    runtimeSkills = ["unknown"];
    const second = await plugin.prompt?.({
      userPrompt: "Investigate the regression",
      system: "Base system"
    });
    expect(second?.system).toBe("Base system");
    expect(getActiveTools).toHaveBeenCalledWith(["repo"]);
    expect(getActiveTools).toHaveBeenCalledWith(["unknown"]);
  });
});
