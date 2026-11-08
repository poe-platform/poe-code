import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ before: [] as (() => Promise<void>)[], after: [] as (() => Promise<void>)[] }));
const spawning = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawning.spawn }));
vi.mock("vitest", async importOriginal => ({
  ...await importOriginal<typeof import("vitest")>(),
  beforeAll: (hook: () => Promise<void>) => hooks.before.push(hook),
  afterAll: (hook: () => Promise<void>) => hooks.after.push(hook),
}));
import { nativeRepeatTemplate } from "../tests/native-repeat-template.js";

afterEach(() => { vi.useRealTimers(); hooks.before.length = 0; hooks.after.length = 0; });

it("allows native import startup within the enclosing hook deadline and drains shutdown", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stderr: new PassThrough(), stdout: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit("close", null, "SIGKILL")); return true; }),
    send: vi.fn((message: { id: number }, callback: (error?: Error) => void) => {
      callback();
      queueMicrotask(() => { child.emit("message", { type: "closed", id: message.id }); child.emit("close", 0, null); });
    }),
  });
  child.kill.mockImplementationOnce(() => { queueMicrotask(() => child.emit("close", null, "SIGKILL")); child.kill.mockImplementation(() => false); return true; });
  spawning.spawn.mockReturnValue(child);
  nativeRepeatTemplate();
  const startup = hooks.before[0]!().then(() => "ready", error => error.message as string);
  let completed = false;
  try {
    await vi.advanceTimersByTimeAsync(6000);
    child.emit("message", { type: "ready" });
    expect(await startup).toBe("ready");
    expect(child.kill).not.toHaveBeenCalled();
    completed = true;
  } finally {
    const shutdown = hooks.after[0]!();
    if (completed) await shutdown;
    else await shutdown.catch(() => undefined);
  }
});
