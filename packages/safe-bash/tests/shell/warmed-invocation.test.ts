import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { InvocationScope } from "../../src/shell/cleanup.js";
import { resolveLimits } from "../../src/shell/runtime.js";

for (const registration of ["shell", "registry"] as const) {
  test(`registration through ${registration} after warming supplies a native signal`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    t.after(() => shell.dispose());
    await shell.exec("");
    let signal: AbortSignal | undefined;
    const command = { name: "probe", execute(context: { signal?: AbortSignal }) {
      signal = context.signal;
      return { exitCode: 0 };
    } };
    if (registration === "shell") shell.register(command);
    else shell.commands.register(command);
    assert.equal((await shell.exec("probe")).exitCode, 0);
    assert.ok(signal instanceof AbortSignal);
  });
}

for (const discard of ["dispose", "shell", "registry", "options", "execute"] as const) test(`discarding a warmed invocation through ${discard} finalizes its owner`, async t => {
  const owners: Parameters<InvocationScope["setOwner"]>[0][] = [];
  const original = InvocationScope.prototype.setOwner;
  t.mock.method(InvocationScope.prototype, "setOwner", function (this: InvocationScope, owner: Parameters<InvocationScope["setOwner"]>[0]) {
    owners.push(owner);
    return original.call(this, owner);
  });
  const shell = new Shell({ fs: new MemoryFileSystem() });
  await shell.exec("");
  let finalized = false;
  const owner = owners[0]!;
  assert.ok("finalized" in owner);
  assert.ok(owner.finalized instanceof Promise);
  void owner.finalized.then(() => { finalized = true; });
  t.after(() => shell.dispose());
  if (discard === "dispose") await shell.dispose();
  else if (discard === "execute") await shell.exec("set -f");
  else if (discard === "options") await shell.exec(":", { env: { X: "1" } });
  else {
    const command = { name: "probe", execute: () => ({ exitCode: 0 }) };
    if (discard === "shell") shell.register(command);
    else shell.commands.register(command);
  }
  await Promise.resolve();
  assert.equal(finalized, true);
});

test("empty invocations leave finite clocks idle", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxWallClockMs: 50, maxCpuMs: 50 } });
  t.after(() => shell.dispose());
  let elapsed = 0;
  t.mock.method(performance, "now", () => elapsed);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  for (let i = 0; i < 3; i++) {
    await shell.exec("");
    elapsed += 100;
    t.mock.timers.tick(100);
  }
  assert.equal((await shell.exec(":")).exitCode, 0);
});

test("resource ceilings accept Infinity and ignore undefined overrides", async t => {
  for (const key of Object.keys(resolveLimits())) {
    if (key === "pipeHighWaterMark") continue;
    assert.equal(resolveLimits({ [key]: Infinity })[key as keyof ReturnType<typeof resolveLimits>], Infinity);
    assert.equal(resolveLimits({ [key]: 7 }, { [key]: undefined })[key as keyof ReturnType<typeof resolveLimits>], 7);
  }
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxWallClockMs: 0 } });
  t.after(() => shell.dispose());
  assert.equal((await shell.exec(":", { limits: { maxWallClockMs: Infinity } })).exitCode, 0);
});

for (const source of ["", ":"]) test(`repeated stateless calls retain one invocation until disposal: ${source}`, async t => {
  const owners = t.mock.method(InvocationScope.prototype, "setOwner");
  const shell = new Shell({ fs: new MemoryFileSystem() });
  t.after(() => shell.dispose());
  await shell.exec("");
  await shell.exec(source);
  await shell.exec(source);
  assert.equal(owners.mock.callCount(), 1);
});

test("an empty bounded invocation clears its deadline timer", async t => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxWallClockMs: 1000 } });
  t.after(() => shell.dispose());
  const timers = t.mock.method(globalThis, "setTimeout");
  const clears = t.mock.method(globalThis, "clearTimeout");
  await shell.exec("");
  assert.ok(timers.mock.callCount() > 0);
  for (const timer of timers.mock.calls) {
    assert.ok(clears.mock.calls.some(call => call.arguments[0] === timer.result));
  }
});
