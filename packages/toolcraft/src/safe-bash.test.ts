import { describe, expect, it, vi } from "vitest";
import { Shell, agentCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { S, defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { createToolcraftCommandExecutor, toolcraftCommands, type ToolcraftInvocation } from "toolcraft/safe-bash";
import { createHumanInLoop } from "./human-in-loop/index.js";

const library = defineGroup({
  name: "tools",
  aliases: ["t"],
  children: [
    defineCommand({ name: "echo", aliases: ["say"], params: S.Object({ message: S.String() }), handler: ({ params }) => params }),
    defineCommand({ name: "fail", params: S.Object({}), handler: () => { throw new Error("handler failed"); } })
  ]
});

async function withShell(run: (shell: Shell) => Promise<void>) {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: {} }).use(agentCommands()).use(toolcraftCommands(library));
  try { await run(shell); } finally { await shell.dispose(); }
}

describe("native toolcraft commands", () => {
  it("registers the whole library and preserves quoted argv through a pipeline", async () => {
    await withShell(async shell => {
      const result = await shell.exec("t say --message 'hello world' --output json | jq .message");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('"hello world"\n');
    });
  });

  it("captures help/version and returns local failure status without touching process state", async () => {
    const hostOutput = vi.spyOn(process.stdout, "write");
    const previousExitCode = process.exitCode;
    await withShell(async shell => {
      const help = await shell.exec("tools --help > help.txt; cat help.txt");
      expect(help.stdout).toContain("echo");
      const invalid = await shell.exec("tools echo --output json && printf incorrect || printf recovered");
      expect(invalid.stdout).toBe("recovered");
      expect(invalid.stderr).toContain("message");
      const failed = await shell.exec("tools fail && printf incorrect || printf recovered");
      expect(failed.stdout).toBe("recovered");
      expect(failed.stderr).toContain("handler failed");
    });
    expect(hostOutput).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(previousExitCode);
    hostOutput.mockRestore();
  });
});

describe("library discovery and configuration", () => {
  it("uses nested declaration paths for alias defaults, including false/zero/null and whole objects", async () => {
    const checked = vi.fn(() => ({ ok: true }));
    const handler = vi.fn(({ params }) => params);
    const defaults = { "users/list_users": { required: "configured", count: 5, enabled: true, nullable: null, tags: ["seed"], object: { left: "seed", right: "seed" }, union: { label: "default" } } };
    const command = defineCommand({
      name: "list_users", aliases: ["ls"],
      params: S.Object({ required: S.String(), count: S.Number({ default: 1 }), enabled: S.Boolean(), nullable: S.Json(), tags: S.Array(S.String()), object: S.Object({ left: S.String(), right: S.String() }), union: S.Union([S.Object({ label: S.String() }), S.Object({ count: S.Number() })]) }),
      requires: { check: checked }, handler
    });
    const root = defineGroup({ name: "configured", children: [defineGroup({ name: "users", aliases: ["u"], children: [command] })] });
    const shell = new Shell({ fs: createMemoryFileSystem(), env: {} }).use(toolcraftCommands(root, { defaults, version: "1.2.3" }));
    try {
      defaults["users/list_users"].tags.push("mutated after registration");
      const result = await shell.exec("configured u ls --count 0 --no-enabled --required '' --output json");
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ required: "", count: 0, enabled: false, nullable: null, tags: ["seed"], object: { left: "seed", right: "seed" }, union: { label: "default" } });
      expect(checked.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ params: JSON.parse(result.stdout) }));
      const replacement = await shell.exec("configured users ls --object.left explicit --output json");
      expect(replacement.exitCode).toBe(1);
      expect(replacement.stderr).toContain("object.right");
      expect(handler).toHaveBeenCalledTimes(1);
      const aliasDefaults = await shell.exec("configured users list-users --tags explicit --nullable null --output json");
      expect(aliasDefaults.exitCode, aliasDefaults.stderr).toBe(0);
      expect(JSON.parse(aliasDefaults.stdout)).toEqual({ required: "configured", count: 5, enabled: true, nullable: null, tags: ["explicit"], object: { left: "seed", right: "seed" }, union: { label: "default" } });
      expect((await shell.exec("configured --version")).stdout).toBe("1.2.3\n");
    } finally { await shell.dispose(); }
  });

  it("rejects invalid default paths, keys and values and reserved services at registration", () => {
    expect(() => toolcraftCommands(library, { defaults: { missing: {} } })).toThrow("Unknown default command path");
    expect(() => toolcraftCommands(library, { defaults: { echo: { typo: 1 } } })).toThrow("Unknown default parameter");
    expect(() => toolcraftCommands(library, { defaults: { echo: { message: 1 } } })).toThrow("Invalid default parameter");
    expect(() => toolcraftCommands(library, { services: { fs: {} } })).toThrow("reserved");
  });

  it("supports enum/array/object/union argv and default commands without exposing hidden or scoped tools", async () => {
    const defaultCommand = defineCommand({ name: "default", params: S.Object({ message: S.String({ default: "default" }) }), handler: ({ params }) => params });
    const root = defineGroup({ name: "schema", default: defaultCommand, children: [defaultCommand,
      defineCommand({ name: "all", params: S.Object({ kind: S.Enum(["a", "b"]), numbers: S.Array(S.Number()), object: S.Object({ text: S.String() }), union: S.Union([S.Object({ first: S.String() }), S.Object({ second: S.Number() })]) }), handler: ({ params }) => params }),
      defineCommand({ name: "hidden", hidden: true, params: S.Object({}), handler: () => "secret" }),
      defineCommand({ name: "sdk", scope: ["sdk"], params: S.Object({}), handler: () => "secret" })
    ] });
    const shell = new Shell({ fs: createMemoryFileSystem(), env: {} }).use(toolcraftCommands(root));
    try {
      expect(JSON.parse((await shell.exec("schema --output json")).stdout)).toEqual({ message: "default" });
      const result = await shell.exec("schema all --kind b --numbers 1 2 --object.text 'hello world' --union-kind first --union.first chosen --output json");
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ kind: "b", numbers: [1, 2], object: { text: "hello world" }, union: { first: "chosen" } });
      for (const name of ["hidden", "sdk"]) {
        const denied = await shell.exec(`schema ${name}`);
        expect(denied.exitCode).toBe(1);
        expect(denied.stdout).toBe("");
        expect((await shell.exec("schema --help")).stdout).not.toContain(name);
      }
    } finally { await shell.dispose(); }
  });
});

function invocation<TServices extends object>(services?: TServices): ToolcraftInvocation<TServices> & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { output.push(new TextDecoder().decode(bytes)); } },
    stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } },
    signal: new AbortController().signal, services, output, errors
  };
}

describe("policies and invocation lifetime", () => {
  it("validates before requirements/approval and gives both final parameters and injected secrets", async () => {
    const check = vi.fn(() => ({ ok: true }));
    const handler = vi.fn(({ params, secrets }) => ({ params, secret: secrets.KEY }));
    const root = defineGroup({ name: "policy", children: [defineCommand({
      name: "run", params: S.Object({ count: S.Number({ minimum: 0 }) }), secrets: { KEY: { env: "SYNTHETIC_KEY" } },
      requires: { auth: true, apiVersion: ">=1.0.0", check },
      humanInLoop: { mode: "sync", message: () => "Allow?" }, handler
    })] });
    const runtime = createHumanInLoop({ provider: { id: "test", requestApproval: vi.fn() } });
    const approve = vi.spyOn(runtime, "invoke").mockImplementation(async (node, ctx) => node.handler(ctx));
    const executor = createToolcraftCommandExecutor(root, { apiVersion: "1.0.0", defaults: { run: { count: 1 } } });
    const call = invocation();
    call.env = { POE_API_KEY: "synthetic", SYNTHETIC_KEY: "synthetic-secret" };
    call.humanInLoop = runtime;
    expect((await executor.execute(["run", "--count", "-1", "--output", "json"], call)).exitCode).toBe(1);
    expect(check).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect((await executor.execute(["run", "--count", "0", "--output", "json"], call)).exitCode).toBe(0);
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ params: { count: 0 } }));
    expect(approve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ params: { count: 0 } }), "run");
    expect(handler).toHaveBeenCalledOnce();
    expect(call.output.join("")).toContain("synthetic-secret");
    const denied = invocation();
    denied.humanInLoop = runtime;
    expect((await executor.execute(["run"], denied)).exitCode).toBe(1);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("requires explicit confirmation and never prompts the host terminal", async () => {
    const handler = vi.fn(() => "done");
    const root = defineGroup({ name: "confirm", children: [defineCommand({ name: "run", confirm: true, params: S.Object({}), handler })] });
    const executor = createToolcraftCommandExecutor(root);
    expect((await executor.execute(["run"], invocation())).exitCode).toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect((await executor.execute(["run", "--yes"], invocation())).exitCode).toBe(0);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("waits for async output sinks before consuming the next stream event and cleans up on failure", async () => {
    const consumed: number[] = [];
    const cleaned = vi.fn();
    const root = defineGroup({ name: "stream", children: [defineStreamCommand({ name: "events", params: S.Object({}), event: S.Number(), async *handler() {
      try { for (const value of [1, 2, 3]) { consumed.push(value); yield value; } }
      finally { cleaned(); }
    } })] });
    let unblock!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    const writing = new Promise<void>(resolve => { started = resolve; });
    const call = invocation();
    call.stdout = { async write() { started(); await blocked; throw new Error("sink budget exceeded"); } };
    const pending = createToolcraftCommandExecutor(root).execute(["events", "--output", "json"], call);
    await writing;
    expect(consumed).toEqual([1]);
    unblock();
    await expect(pending).rejects.toThrow("sink budget exceeded");
    expect(cleaned).toHaveBeenCalledOnce();
    expect(consumed).toEqual([1]);
  });

  it("cancels only the active invocation and runs streaming cleanup", async () => {
    const cleaned = vi.fn();
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const root = defineGroup({ name: "stream", children: [defineStreamCommand({ name: "wait", params: S.Object({}), event: S.Number(), async *handler({ signal }) {
      try {
        entered();
        await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
        signal.throwIfAborted();
        yield 1;
      } finally { cleaned(); }
    } })] });
    const controller = new AbortController();
    const call = invocation();
    call.signal = controller.signal;
    const pending = createToolcraftCommandExecutor(root).execute(["wait", "--output", "json"], call);
    await ready;
    const reason = new Error("cancel this invocation");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(cleaned).toHaveBeenCalledOnce();
    expect(call.output).toEqual([]);
  });

  it("preserves independent services, environments and filesystems across simultaneous calls and roots", async () => {
    const makeLibrary = (name: string) => defineGroup<{ api: object; baseUrl: string }>({ name, children: [
      defineCommand<{ api: object; baseUrl: string }>({ name: "read", params: S.Object({}), async handler({ api, baseUrl, env, fs }) {
        await Promise.resolve();
        expect(api).toBe(clients[baseUrl]);
        return { baseUrl, env: env.get("MARKER"), file: await fs.readFile("input.txt") };
      } }),
      defineCommand<{ api: object; baseUrl: string }>({ name: "second", params: S.Object({}), handler: ({ baseUrl }) => baseUrl })
    ] });
    const clients: Record<string, object> = { first: {}, second: {} };
    const executor = createToolcraftCommandExecutor([makeLibrary("one"), makeLibrary("two")]);
    const first = invocation({ baseUrl: "first", api: clients.first! });
    const second = invocation({ baseUrl: "second", api: clients.second! });
    first.env = { MARKER: "first-env" }; second.env = { MARKER: "second-env" };
    await first.fs.writeFile("/input.txt", new TextEncoder().encode("first-file"));
    await second.fs.writeFile("/input.txt", new TextEncoder().encode("second-file"));
    const results = await Promise.all([executor.execute(["one", "read", "--output", "json"], first), executor.execute(["two", "read", "--output", "json"], second)]);
    expect(results).toEqual([{ exitCode: 0 }, { exitCode: 0 }]);
    expect(JSON.parse(first.output.join(""))).toEqual({ baseUrl: "first", env: "first-env", file: "first-file" });
    expect(JSON.parse(second.output.join(""))).toEqual({ baseUrl: "second", env: "second-env", file: "second-file" });
    expect((await executor.execute(["two", "second", "--output", "json"], second)).exitCode).toBe(0);
    expect(second.output.at(-1)).toContain("second");
  });
});

describe("shell streams and diagnostics", () => {
  it("enforces the shell output budget on streaming results", async () => {
    const cleaned = vi.fn();
    const root = defineGroup({ name: "budget", children: [defineStreamCommand({ name: "events", params: S.Object({}), event: S.String(), async *handler() {
      try { for (let index = 0; index < 10; index++) yield "0123456789"; }
      finally { cleaned(); }
    } })] });
    const shell = new Shell({ fs: createMemoryFileSystem(), env: {}, limits: { maxOutputBytes: 30 } }).use(toolcraftCommands(root));
    try {
      await expect(shell.exec("budget events --output json")).rejects.toThrow();
      expect(cleaned).toHaveBeenCalledOnce();
    } finally { await shell.dispose(); }
  });

  it("captures diagnostics, renderer primitives, unknown options and denied network locally", async () => {
    const root = defineGroup({ name: "output", children: [
      defineCommand({ name: "render", params: S.Object({}), handler({ diagnostics }) { diagnostics.emit({ level: "warn", message: "injected diagnostic" }); return "result"; }, render: { rich(result, primitives) { primitives.note("local note"); primitives.logger.info(`rendered ${result}`); } } }),
      defineCommand({ name: "network", params: S.Object({}), handler: ({ fetch }) => fetch("https://example.invalid") })
    ] });
    const call = invocation();
    const executor = createToolcraftCommandExecutor(root);
    const hostOutput = vi.spyOn(process.stdout, "write");
    const hostErrors = vi.spyOn(process.stderr, "write");
    try {
      expect((await executor.execute(["render"], call)).exitCode).toBe(0);
      expect(call.output.join("")).toContain("local note");
      expect(call.output.join("")).toContain("rendered result");
      expect(call.errors.join("")).toContain("injected diagnostic");
      expect((await executor.execute(["render", "--unknown"], call)).exitCode).toBe(1);
      expect(call.errors.join("")).toContain("unknown");
      expect((await executor.execute(["network"], call)).exitCode).toBe(1);
      expect(call.errors.join("")).toContain("Network capability is unavailable");
      expect(hostOutput).not.toHaveBeenCalled();
      expect(hostErrors).not.toHaveBeenCalled();
    } finally { hostOutput.mockRestore(); hostErrors.mockRestore(); }
  });
});

it("reports service-factory and root-selection errors through local stderr/status", async () => {
  const call = invocation();
  const factory = createToolcraftCommandExecutor(library, { services() { throw new Error("configuration unavailable"); } });
  expect(await factory.execute(["echo"], call)).toEqual({ exitCode: 1 });
  expect(call.errors.join("")).toContain("configuration unavailable");
  const roots = createToolcraftCommandExecutor([library]);
  expect(await roots.execute(["missing", "echo"], call)).toEqual({ exitCode: 1 });
  expect(call.errors.join("")).toContain("Unknown toolcraft root");
});
