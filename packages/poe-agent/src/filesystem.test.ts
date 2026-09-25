import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createMemoryFileSystem,
  createNodeFsBridge,
  createReadOnlyFileSystem,
  createOverlayFileSystem
} from "@poe-code/safe-fs";
import { agent } from "./agent.js";
import filesPlugin from "./plugins/poe-agent-plugin-files.js";
import memoryPlugin from "./plugins/poe-agent-plugin-memory.js";
import { toAcpModelResponse } from "./testing/model-response.js";

beforeAll(async () => {
  // Load virtual grep's runtime before the file-operation deadline starts.
  await import("@poe-platform/safe-bash/search");
});

const bytes = (text: string) => new TextEncoder().encode(text);
async function workspace(text = "virtual needle\n") {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/workspace/home", { recursive: true });
  await fs.writeFile("/workspace/sample.txt", bytes(text));
  await fs.writeFile("/workspace/AGENTS.md", bytes(text));
  return fs;
}
const model = (): import("./runtime/acp-core.js").AcpModel & {
  complete: ReturnType<typeof vi.fn>;
} => ({ complete: vi.fn(async () => toAcpModelResponse({ content: "done", toolCalls: [] })) });

describe("agent filesystem capability", () => {
  it("preserves the provider across builders and supplies every lifecycle callback", async () => {
    const fs = await workspace();
    const seen: unknown[] = [];
    const bot = agent({ fs, cwd: "/workspace", homeDir: "/workspace/home" })
      .model("synthetic")
      .use({
        name: "inspect",
        setup(api) {
          seen.push(api.fs);
          expect(api.cwd).toBe("/workspace");
        },
        prompt(ctx, runtime) {
          seen.push(runtime?.fs);
          return ctx;
        },
        hooks: {
          sessionStart(_ctx, runtime) {
            seen.push(runtime?.fs);
          },
          stop(_ctx, runtime) {
            seen.push(runtime?.fs);
          }
        },
        dispose(runtime) {
          seen.push(runtime?.fs);
        }
      });
    await bot.run("hello", { acpModel: model() });
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(seen.every((value) => value === fs)).toBe(true);
    expect(await fs.readFile("/workspace/sample.txt")).toEqual(bytes("virtual needle\n"));
  });

  it("reads, edits, globs and greps an entirely virtual workspace", async () => {
    const fs = await workspace();
    const results: unknown[] = [];
    const bot = agent({ fs, cwd: "/workspace", homeDir: "/workspace/home" })
      .use(filesPlugin())
      .use({
        name: "probe",
        async setup(api) {
          const ctx = { runtime: api.runtime, signal: api.signal, fork: vi.fn(), spawn: vi.fn() };
          for (const [name, args] of [
            ["read_file", { path: "sample.txt" }],
            ["glob", { pattern: "**/*.txt" }],
            ["grep", { pattern: "needle", path: "sample.txt", line_numbers: true }],
            [
              "edit_file",
              { command: "str_replace", path: "sample.txt", old_str: "needle", new_str: "changed" }
            ]
          ] as const)
            results.push(await api.getTool(name)!.invoke(args, ctx).next());
        }
      });
    const session = await bot.acp("hello", { acpModel: model() });
    await session.dispose();
    expect(results.map((result) => (result as { value: unknown }).value)).toEqual([
      "virtual needle\n",
      "sample.txt",
      "sample.txt:1:virtual needle",
      "Edited file: sample.txt"
    ]);
    expect(await fs.readFile("/workspace/sample.txt")).toEqual(bytes("virtual changed\n"));
  });

  it("isolates a shared memory plugin across concurrent agents and runs", async () => {
    const shared = memoryPlugin();
    const systems: string[] = [];
    await Promise.all(
      ["first", "second"].map(async (text) => {
        const fs = await workspace(text);
        const acpModel = model();
        acpModel.complete.mockImplementation(async (request) => {
          systems.push(
            JSON.stringify(
              request.messages.filter((message: { role: string }) => message.role === "system")
            )
          );
          return toAcpModelResponse({ content: "done", toolCalls: [] });
        });
        await agent({ fs, cwd: "/workspace", homeDir: "/workspace/home" })
          .use(shared)
          .run("hello", { acpModel });
      })
    );
    expect(systems.some((system) => system.includes("first") && !system.includes("second"))).toBe(
      true
    );
    expect(systems.some((system) => system.includes("second") && !system.includes("first"))).toBe(
      true
    );
  });

  it("rejects a legacy plugin filesystem that conflicts with the agent provider", async () => {
    const fs = await workspace();
    await expect(
      agent({ fs, cwd: "/workspace" })
        .use(filesPlugin({ fs: createNodeFsBridge(await workspace()) }))
        .acp("hello", { acpModel: model() })
    ).rejects.toMatchObject({ cause: { message: expect.stringContaining("conflict") } });
  });

  it("completes the Node bridge unlink contract without removing directories", async () => {
    const fs = await workspace();
    const bridge = createNodeFsBridge(fs, { cwd: "/workspace" });
    await expect(bridge.unlink("home")).rejects.toMatchObject({ code: "EISDIR" });
    await bridge.unlink("sample.txt");
    await expect(fs.readFile("/workspace/sample.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it("propagates read-only failures and keeps overlay edits off the backing filesystem", async () => {
  const base = await workspace();
  for (const fs of [
    createReadOnlyFileSystem(base),
    createOverlayFileSystem({ lower: base, upper: createMemoryFileSystem() })
  ]) {
    const edit = async () => {
      const session = await agent({ fs, cwd: "/workspace" })
        .use(filesPlugin())
        .use({
          name: "edit-probe",
          async setup(api) {
            const ctx = { runtime: api.runtime, signal: api.signal, fork: vi.fn(), spawn: vi.fn() };
            await api
              .getTool("edit_file")!
              .invoke({ command: "overwrite", path: "sample.txt", file_text: "overlay" }, ctx)
              .next();
          }
        })
        .acp("hello", { acpModel: model() });
      await session.dispose();
    };
    if (fs.capabilities.readOnly)
      await expect(edit()).rejects.toMatchObject({ cause: { code: "EROFS" } });
    else {
      await edit();
      expect(await fs.readFile("/workspace/sample.txt")).toEqual(bytes("overlay"));
    }
    expect(await base.readFile("/workspace/sample.txt")).toEqual(bytes("virtual needle\n"));
  }
});

it("rejects traversal, symlink reads and host-only tools with an explicit provider", async () => {
  const fs = await workspace();
  await fs.writeFile("/outside.txt", bytes("sentinel"));
  await fs.symlink!("/outside.txt", "/workspace/link.txt");
  const session = await agent({ fs, cwd: "/workspace" })
    .use(filesPlugin())
    .use({
      name: "deny-probe",
      async setup(api) {
        const ctx = { runtime: api.runtime, signal: api.signal, fork: vi.fn(), spawn: vi.fn() };
        for (const path of ["../outside.txt", "link.txt"]) {
          await expect(api.getTool("read_file")!.invoke({ path }, ctx).next()).rejects.toThrow();
        }
      }
    })
    .acp("hello", { acpModel: model() });
  await session.dispose();
  await expect(
    agent({ fs })
      .mcp({ name: "host", command: "host-sentinel" })
      .acp("hello", { acpModel: model() })
  ).rejects.toMatchObject({ cause: { message: expect.stringContaining("host capability") } });
});

it("inherits the provider in fork tools with child-specific runtime signals", async () => {
  const fs = await workspace();
  const runtimes: import("./runtime/filesystem.js").AgentRuntime[] = [];
  const responses = [
    { toolCalls: [{ name: "fork_probe", args: {} }] },
    { toolCalls: [{ name: "read_probe", args: {} }] },
    { content: "child" },
    { content: "parent" }
  ];
  const acpModel = { complete: vi.fn(async () => toAcpModelResponse(responses.shift()!)) };
  const result = await agent({ fs, cwd: "/workspace" })
    .use({
      name: "fork-test",
      prompt(ctx, runtime) {
        runtimes.push(runtime!);
        return ctx;
      },
      tools: [
        {
          name: "fork_probe",
          async call(_args, ctx) {
            return (await ctx.fork("child")).output;
          }
        },
        {
          name: "read_probe",
          async call(_args, ctx) {
            expect(ctx.runtime?.fs).toBe(fs);
            expect(ctx.runtime?.cwd).toBe("/workspace");
            return new TextDecoder().decode(
              await ctx.runtime!.fs.readFile("/workspace/sample.txt")
            );
          }
        }
      ]
    })
    .run("parent", { acpModel });
  expect(result.exitCode).toBe(0);
  expect(runtimes.every((runtime) => runtime.fs === fs)).toBe(true);
  expect(new Set(runtimes.map((runtime) => runtime.signal)).size).toBe(2);
});

it("uses canonical persistence for session history and forks", async () => {
  const { createAgentSession } = await import("./agent-session.js");
  const fs = await workspace();
  const observed: unknown[] = [];
  const session = await createAgentSession({
    fs,
    cwd: "/workspace",
    homeDir: "/workspace/home",
    model: "synthetic",
    persist: { directory: "~/sessions" },
    plugins: [
      {
        name: "local-model",
        providers: [{ name: "local", supports: () => true, createModel: () => model() }],
        setup(api) {
          observed.push(api.fs);
        }
      }
    ]
  });
  await session.sendMessage("first");
  const first = session.tree()[0]!;
  const fork = await session.fork(first.id);
  await fork.sendMessage("second");
  expect(observed.every((value) => value === fs)).toBe(true);
  const logs = await fs.readdir("/workspace/home/sessions");
  expect(logs).toHaveLength(2);
  expect(
    new TextDecoder().decode(await fs.readFile(`/workspace/home/sessions/${logs[0]!.name}`))
  ).toContain('"kind":"user"');
  await fork.dispose();
  await session.dispose();
});

it("writes run transcripts to the same provider and honors cancellation", async () => {
  const fs = await workspace();
  await agent({ fs, cwd: "/workspace" }).run("hello", {
    acpModel: model(),
    logPath: "/workspace/run.jsonl"
  });
  expect(new TextDecoder().decode(await fs.readFile("/workspace/run.jsonl"))).toContain(
    "agent_message_chunk"
  );
  const controller = new AbortController();
  controller.abort(Object.assign(new Error("cancelled"), { code: "ENOENT" }));
  await expect(
    agent({ fs }).acp("hello", { acpModel: model(), signal: controller.signal })
  ).rejects.toThrow("Run aborted");
});

it("accepts an existing Node bridge of the same provider and preserves signal cancellation", async () => {
  const fs = await workspace();
  const session = await agent({ fs, cwd: "/workspace" })
    .use(filesPlugin({ fs: createNodeFsBridge(fs) }))
    .acp("hello", { acpModel: model() });
  await session.dispose();
});

it("passes the provider and namespace to internal child session creation", async () => {
  const { createInMemoryAcpTransport } = await import("./runtime/agent-host.js");
  const fs = await workspace();
  const createSession = vi.fn(async () => ({ sendMessage: vi.fn(), dispose: vi.fn() }));
  const transport = createInMemoryAcpTransport({ model: "synthetic", fs, cwd: "/workspace", homeDir: "/workspace/home", createSession });
  await transport.sendRequest("session/new", {});
  expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ fs, cwd: "/workspace", homeDir: "/workspace/home" }));
  transport.dispose();
});

it("uses virtual grep for an existing canonical Node bridge on a legacy host agent", async () => {
  const fs = await workspace();
  const plugin = filesPlugin({ fs: createNodeFsBridge(fs), cwd: "/workspace" });
  const grep = plugin.tools!.find(tool => tool.name === "grep")!;
  const result = await grep.call({ pattern: "needle", path: "sample.txt" }, { signal: new AbortController().signal, fork: vi.fn(), spawn: vi.fn() });
  expect(result).toBe("sample.txt:virtual needle");
});
