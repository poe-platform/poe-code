import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createBzip2Command } from "./index.js";

test("bzip2 observes timer cancellation with frozen clocks and empty input chunks", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  Reflect.deleteProperty(globalThis, "setImmediate");
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, "setImmediate", descriptor); });
  const now = Object.getOwnPropertyDescriptor(performance, "now");
  Object.defineProperty(performance, "now", { value: () => 0, configurable: true });
  t.after(() => { if (now) Object.defineProperty(performance, "now", now); else Reflect.deleteProperty(performance, "now"); });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timer cancellation")), 0);
  t.after(() => clearTimeout(timer));
  const result = createBzip2Command().execute({
    command: "bzip2", args: createCommandArguments([]).args, cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: controller.signal,
    stdin: (async function* () { for (let i = 0; i < 10000; i++) yield new Uint8Array(); })(),
    stdout: { write: async () => {} }, stderr: { write: async () => {} },
  });
  await assert.rejects(async () => await result, /timer cancellation/);
});
