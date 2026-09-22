import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { S, defineCommand, defineGroup } from "./index.js";
import { toolcraftCommands } from "./safe-bash.js";

it("forwards native capabilities through a handler's nested literal invocation", async () => {
  const client = {};
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/input", Uint8Array.of(0, 255));
  const root = defineGroup({ name: "nested", children: [defineCommand({ name: "run", params: S.Object({}), async handler(ctx) {
    return ctx.invoke!("probe", [], { env: { CHILD: "yes" } });
  } })] });
  const shell = new Shell({ fs, cwd: "/work", env: { PARENT: "yes" }, capabilities: { services: { client } } }).use(toolcraftCommands(root));
  const probe = vi.fn(async (ctx: import("@poe-platform/safe-bash").CommandContext) => {
    expect((ctx.capabilities?.services as { client: object }).client).toBe(client);
    expect(ctx.cwd).toBe("/work");
    expect(ctx.env).toMatchObject({ PARENT: "yes", CHILD: "yes" });
    expect([...await ctx.fs.readFile("/work/input", { signal: ctx.signal })]).toEqual([0, 255]);
    return { exitCode: 0 };
  });
  shell.register({ name: "probe", execute: probe });
  try {
    const result = await shell.exec("nested run --output json");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ exitCode: 0 });
    expect(probe).toHaveBeenCalledOnce();
  } finally { await shell.dispose(); }
});

it("allows an invocation to revoke default network authorization without altering later invocations", async () => {
  const fetch = vi.fn(async () => new Response("allowed"));
  const root = defineGroup({ name: "network", children: [defineCommand({ name: "run", params: S.Object({}), async handler(ctx) {
    return { body: await (await ctx.fetch("https://synthetic.test")).text() };
  } })] });
  const shell = new Shell({ fs: createMemoryFileSystem(), env: {}, capabilities: { fetch } }).use(toolcraftCommands(root));
  try {
    const denied = await shell.exec("network run --output json", { capabilities: { fetch: undefined } });
    expect(denied.exitCode).toBe(1);
    expect(denied.stderr).toContain("Network capability is unavailable");
    expect(fetch).not.toHaveBeenCalled();
    const allowed = await shell.exec("network run --output json");
    expect(allowed.exitCode, allowed.stderr).toBe(0);
    expect(JSON.parse(allowed.stdout)).toEqual({ body: "allowed" });
    expect(fetch).toHaveBeenCalledOnce();
  } finally { await shell.dispose(); }
});

it("waits for a handler's registered asynchronous cleanup before rejecting cancellation", async () => {
  let enter!: () => void;
  let cleaning!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const cleanupStarted = new Promise<void>(resolve => { cleaning = resolve; });
  const cleanupGate = new Promise<void>(resolve => { release = resolve; });
  const cleaned = vi.fn();
  const root = defineGroup({ name: "lifetime", children: [defineCommand({ name: "run", params: S.Object({}), async handler(ctx) {
    ctx.registerCleanup!(async () => { cleaning(); await cleanupGate; cleaned(); });
    enter();
    await new Promise<void>(resolve => ctx.signal!.addEventListener("abort", () => resolve(), { once: true }));
    ctx.signal!.throwIfAborted();
    return {};
  } })] });
  const shell = new Shell({ fs: createMemoryFileSystem(), env: {} }).use(toolcraftCommands(root));
  const controller = new AbortController();
  const pending = shell.exec("lifetime run", { signal: controller.signal });
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await entered;
    const reason = new Error("synthetic caller cancellation");
    controller.abort(reason);
    await cleanupStarted;
    expect(settled).toBe(false);
    expect(cleaned).not.toHaveBeenCalled();
    release();
    await expect(pending).rejects.toBe(reason);
    expect(cleaned).toHaveBeenCalledOnce();
  } finally { release(); controller.abort(); await shell.dispose(); }
});
