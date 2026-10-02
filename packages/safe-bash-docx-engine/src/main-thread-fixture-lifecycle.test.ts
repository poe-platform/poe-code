import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ before: [] as (() => Promise<void>)[], after: [] as (() => Promise<void>)[] }));
const spawning = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawning.spawn }));
vi.mock("esbuild", () => ({ build: async () => ({ outputFiles: [{ contents: new Uint8Array() }] }) }));
vi.mock("vitest", async importOriginal => ({
  ...await importOriginal<typeof import("vitest")>(),
  beforeAll: (hook: () => Promise<void>) => hooks.before.push(hook),
  afterAll: (hook: () => Promise<void>) => hooks.after.push(hook),
}));
import { mainThreadFixture } from "../tests/main-thread.js";

afterEach(() => { vi.useRealTimers(); hooks.before.length = 0; hooks.after.length = 0; });

it("allows a native request within the enclosing test deadline and drains its child", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    connected: true, exitCode: null as number | null, signalCode: null,
    stdin: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => { child.connected = false; child.exitCode = 0; child.emit("exit", 0, null); }); return true; }),
    send: vi.fn((_message: string, callback: (error?: Error) => void) => {
      callback(); setTimeout(() => child.emit("message", { value: "completed" }), 5000);
    }),
  });
  child.stdin.end = vi.fn(() => { queueMicrotask(() => child.emit("message", { value: "ready" })); return child.stdin; });
  spawning.spawn.mockReturnValue(child);
  const execute = mainThreadFixture(new URL("../tests/fixtures/tracked-cli-review-views-native.mjs", import.meta.url));
  await hooks.before[0]!();
  try {
    const request = execute({}).catch(error => (error as Error).message);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await request).toBe("completed");
    expect(child.kill).not.toHaveBeenCalled();
  } finally { await hooks.after[0]!(); }
  expect(child.kill).toHaveBeenCalledOnce();
});
