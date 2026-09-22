import { describe, expect, it, vi } from "vitest";
import { Shell, agentCommands, createMemoryFileSystem, createOverlayFileSystem, RegexExecutor, CommandRegistry, type BoundedRegexProvider } from "@poe-platform/safe-bash";
import { S, defineCommand, defineGroup, defineStreamCommand } from "./index.js";
import { toolcraftCommands } from "./safe-bash.js";

describe("toolcraft invocation capabilities", () => {
  it("inherits configured regex, services and authorized network through nested dispatch", async () => {
    const rejected = new Error("sentinel regex budget rejection");
    const provider: BoundedRegexProvider = { createWorker: vi.fn(() => { throw rejected; }) };
    const client = {};
    const fetch = vi.fn(async () => new Response("authorized"));
    const cleaned = vi.fn();
    const handler = vi.fn(async (ctx: any) => {
      expect(ctx.client).toBe(client);
      expect(ctx.regex.executor).toBe(provider);
      expect(ctx.regex.limits.requestTimeoutMs).toBe(17);
      const executor = new RegexExecutor(ctx.regex.executor, ctx.regex.limits);
      ctx.registerCleanup(() => executor.dispose());
      await expect(executor.request({ kind: "grep", patterns: ["x"], fixed: false, extended: true, insensitive: false, whole: false, word: false }, [{ bytes: Uint8Array.of(120), all: true, terminated: true }], ctx.signal)).rejects.toBe(rejected);
      expect(await (await ctx.fetch("https://synthetic.test")).text()).toBe("authorized");
      ctx.registerCleanup(cleaned);
      return { marker: ctx.env.get("MARKER"), cwd: ctx.cwd };
    });
    const root = defineGroup({ name: "caps", children: [defineCommand({ name: "run", params: S.Object({}), handler })] });
    const shell = new Shell({ fs: createMemoryFileSystem(), env: { MARKER: "injected" }, capabilities: { services: { client }, fetch } })
      .use(agentCommands({ regexExecutor: provider, regex: { requestTimeoutMs: 17 } })).use(toolcraftCommands(root));
    shell.register({ name: "nested", execute: ctx => ctx.invoke!("caps", ["run", "--output", "json"]) });
    try {
      const result = await shell.exec("nested");
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ marker: "injected", cwd: "/" });
      expect(cleaned).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
      expect(provider.createWorker).toHaveBeenCalledOnce();
    } finally { await shell.dispose(); }
  });

  it("keeps concurrent invocation services, env, filesystem and denied network isolated", async () => {
    const clients = [{}, {}];
    const root = defineGroup({ name: "caps", children: [defineCommand({ name: "run", params: S.Object({}), async handler(ctx: any) {
      await Promise.resolve();
      expect(ctx.client).toBe(clients[Number(ctx.env.get("MARKER"))]);
      await expect(ctx.fetch("https://synthetic.test")).rejects.toThrow("Network capability is unavailable");
      return { value: await ctx.fs.readFile("input") };
    } })] });
    const shell = new Shell({ fs: createMemoryFileSystem(), env: {} }).use(toolcraftCommands(root));
    const filesystems = clients.map(() => createMemoryFileSystem());
    await Promise.all(filesystems.map((fs, index) => fs.writeFile("/input", new TextEncoder().encode(String(index)))));
    try {
      const results = await Promise.all(filesystems.map((fs, index) => shell.exec("caps run --output json", { fs, env: { MARKER: String(index) }, capabilities: { services: { client: clients[index] } } })));
      expect(results.map(result => result.exitCode)).toEqual([0, 0]);
      expect(results.map(result => JSON.parse(result.stdout))).toEqual([{ value: "0" }, { value: "1" }]);
    } finally { await shell.dispose(); }
  });
});

describe("invocation filesystem and byte streams", () => {
  const files = defineGroup({ name: "files", children: [defineCommand({ name: "mutate", params: S.Object({}), async handler({ fs, stdout }) {
    await fs.writeFile("created", "AP8=", { encoding: "base64", flag: "wx", mode: 0o600 });
    await fs.writeFile("created", "AQ==", { encoding: "base64", flag: "a" });
    const encoded = await fs.readFile("created", "base64");
    await fs.rename("created", "renamed");
    expect(await fs.exists("created")).toBe(false);
    expect((await fs.lstat("renamed")).isSymbolicLink()).toBe(false);
    await fs.unlink("renamed");
    expect(await fs.exists("renamed")).toBe(false);
    await stdout!.write(Uint8Array.of(0, 255, 1));
    return { encoded };
  } })] });

  it("uses the invocation provider for cwd-relative mutations, encoding and redirection", async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    const writes = vi.spyOn(fs, "writeFile");
    const reads = vi.spyOn(fs, "readFile");
    const renames = vi.spyOn(fs, "rename");
    const deletes = vi.spyOn(fs, "unlink");
    const shell = new Shell({ fs, cwd: "/work", env: {} }).use(agentCommands()).use(toolcraftCommands(files));
    try {
      const result = await shell.exec("files mutate --output json > artifact");
      expect(result.exitCode, result.stderr).toBe(0);
      const artifact = await fs.readFile("/work/artifact");
      expect([...artifact.slice(0, 3)]).toEqual([0, 255, 1]);
      expect(new TextDecoder().decode(artifact.slice(3))).toContain('"encoded": "AP8B"');
      expect(writes).toHaveBeenCalledWith("/work/created", Buffer.from([0, 255]), expect.objectContaining({ flag: "wx", mode: 0o600, signal: expect.any(AbortSignal) }));
      expect(reads).toHaveBeenCalledWith("/work/created", expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(renames).toHaveBeenCalledWith("/work/created", "/work/renamed", expect.anything());
      expect(deletes).toHaveBeenCalledWith("/work/renamed", expect.anything());
    } finally { await shell.dispose(); }
  });

  it("preserves mock writes/readback without touching the lower filesystem or exposing dry-run", async () => {
    const lower = createMemoryFileSystem();
    await lower.writeFile("/sentinel", new TextEncoder().encode("unchanged"));
    const mutations = vi.spyOn(lower, "writeFile");
    const overlay = createOverlayFileSystem({ lower, upper: createMemoryFileSystem() });
    const root = defineGroup({ name: "mock", children: [defineCommand({ name: "run", params: S.Object({}), async handler(ctx) {
      expect("dryRun" in ctx).toBe(false);
      await ctx.fs.writeFile("/sentinel", "mocked");
      return { value: await ctx.fs.readFile("/sentinel") };
    } })] });
    const shell = new Shell({ fs: overlay, env: {} }).use(toolcraftCommands(root));
    try {
      const result = await shell.exec("mock run --output json");
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ value: "mocked" });
      expect(new TextDecoder().decode(await lower.readFile("/sentinel"))).toBe("unchanged");
      expect(mutations).not.toHaveBeenCalled();
    } finally { await shell.dispose(); }
  });

  it("enforces operation and output budgets without giving handlers a replacement filesystem", async () => {
    const fs = createMemoryFileSystem();
    const writes = vi.spyOn(fs, "writeFile");
    const shell = new Shell({ fs, env: {}, limits: { maxFileSystemOperations: 1 } }).use(toolcraftCommands(files));
    try {
      await expect(shell.exec("files mutate --output json")).rejects.toThrow("maxFileSystemOperations");
      expect(writes).toHaveBeenCalledOnce();
    } finally { await shell.dispose(); }
    const outputShell = new Shell({ fs: createMemoryFileSystem(), env: {}, limits: { maxOutputBytes: 2 } }).use(toolcraftCommands(files));
    try { await expect(outputShell.exec("files mutate --output json")).rejects.toThrow("maxOutputBytes"); }
    finally { await outputShell.dispose(); }
  });
});

describe("native policy capabilities", () => {
  it("inherits approvals and gives requirement checks the same runtime context", async () => {
    const { createHumanInLoop } = await import("./human-in-loop/index.js");
    const client = {};
    const approval = createHumanInLoop({ provider: { id: "synthetic", requestApproval: vi.fn() } });
    const handler = vi.fn(() => ({ allowed: true }));
    const approve = vi.spyOn(approval, "invoke").mockImplementation(async (node, ctx) => {
      expect((ctx as any).client).toBe(client);
      return node.handler(ctx);
    });
    const check = vi.fn(async (ctx: any) => {
      expect(ctx.client).toBe(client);
      expect(ctx.cwd).toBe("/");
      expect(ctx.signal).toBeInstanceOf(AbortSignal);
      return { ok: true };
    });
    const root = defineGroup({ name: "policy", children: [defineCommand({ name: "run", params: S.Object({}), requires: { check }, humanInLoop: { mode: "sync", message: () => "Allow?" }, handler })] });
    const shell = new Shell({ fs: createMemoryFileSystem(), env: {}, capabilities: { services: { client }, humanInLoop: approval } }).use(toolcraftCommands(root));
    try {
      const result = await shell.exec("policy run --output json");
      expect(result.exitCode, result.stderr).toBe(0);
      expect(check).toHaveBeenCalledOnce();
      expect(approve).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledOnce();
    } finally { await shell.dispose(); }
  });

  it("rejects reserved runtime service collisions before a handler runs", async () => {
    const handler = vi.fn();
    const root = defineGroup({ name: "reserved", children: [defineCommand({ name: "run", params: S.Object({}), handler })] });
    for (const key of ["fs", "regex", "signal", "stdout", "registerCleanup", "invoke", "inputBudget"]) {
      const shell = new Shell({ fs: createMemoryFileSystem(), env: {}, capabilities: { services: { [key]: {} } } }).use(toolcraftCommands(root));
      try {
        const result = await shell.exec("reserved run");
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("reserved");
      } finally { await shell.dispose(); }
    }
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("library configuration retains invocation capabilities", () => {
  it("retains injected service identities alongside configured library services", async () => {
    const client = {};
    const root = defineGroup<{ client: object; baseUrl: string }>({ name: "configured", children: [defineCommand<{ client: object; baseUrl: string }>({ name: "run", params: S.Object({}), handler({ client: received, baseUrl }) {
      expect(received).toBe(client);
      return { baseUrl };
    } })] });
    const shell = new Shell({ fs: createMemoryFileSystem(), env: {}, capabilities: { services: { client } } })
      .use(toolcraftCommands(root, { services: () => ({ baseUrl: "https://synthetic.test" }) as { client: object; baseUrl: string } }));
    try {
      const result = await shell.exec("configured run --output json");
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ baseUrl: "https://synthetic.test" });
    } finally { await shell.dispose(); }
  });
});

describe("real plugin stream lifetime", () => {
  it("preserves byte stdin and sink backpressure and closes streaming handlers on cancellation", async () => {
    let entered!: () => void;
    let writing!: () => void;
    let unblock!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const wrote = new Promise<void>(resolve => { writing = resolve; });
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    let nextEvent!: () => void;
    const next = new Promise<void>(resolve => { nextEvent = resolve; });
    const events: number[] = [];
    const cleaned = vi.fn();
    const root = defineGroup({ name: "stream", children: [defineStreamCommand({ name: "run", params: S.Object({}), event: S.Number(), async *handler(ctx) {
      try {
        const bytes: number[] = [];
        for await (const chunk of ctx.stdin!) bytes.push(...chunk);
        expect(bytes).toEqual([0, 255]);
        entered();
        events.push(1);
        yield 1;
        events.push(2);
        nextEvent();
        ctx.signal.throwIfAborted();
        await new Promise<void>(resolve => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
        ctx.signal.throwIfAborted();
      } finally { cleaned(); }
    } })] });
    const shell = new Shell({ fs: createMemoryFileSystem(), env: {} }).use(toolcraftCommands(root));
    const controller = new AbortController();
    const pending = shell.exec("stream run --output json", { signal: controller.signal, stdin: { async *[Symbol.asyncIterator]() { yield Uint8Array.of(0, 255); } }, stdout: { async write() { writing(); await gate; } } });
    try {
      await ready;
      await wrote;
      expect(events).toEqual([1]);
      unblock();
      await next;
      const reason = new Error("synthetic cancellation");
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(cleaned).toHaveBeenCalledOnce();
    } finally { unblock(); controller.abort(); await shell.dispose(); }
  });
});

it("rejects hosts that cannot carry invocation capabilities instead of silently dropping them", () => {
  const plugin = toolcraftCommands(defineGroup({ name: "caps", children: [] }));
  expect(() => plugin.setup({ commands: new CommandRegistry(), use() {}, registerFileSystem() {} })).toThrow("invocation capabilities");
});
