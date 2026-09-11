import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { toByteSource } from "../../src/contracts/index.js";
import { networkCommands } from "../../src/commands/network/index.js";
import { standardCommands } from "../../src/commands/index.js";

const curl = "curl -s https://offline.invalid/start";

function gate<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return { promise, resolve };
}

for (const script of [
  `${curl}; ${curl}`,
  `${curl}; sh -c '${curl}'`,
  `${curl}; env curl -s https://offline.invalid/start`,
  `${curl}; result=$(${curl}); test $? -eq 28`,
]) {
  test(`Shell.exec shares the deadline across command dispatch: ${script}`, async context => {
    let now = 0;
    context.mock.method(performance, "now", () => now);
    let requests = 0;
    const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxWallClockMs: 600_000 } }).use(standardCommands()).use(networkCommands({
      authorize: () => true, limits: { maxTotalTimeMs: 100 },
      async transport() {
        requests++;
        now += 100;
        return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), async dispose() {} };
      },
    }));
    try {
      const result = await shell.exec(script);
      assert.equal(requests, 1, "a later command must not get a new aggregate deadline");
      assert.equal(result.exitCode, script.includes("test") ? 0 : 28);
    } finally { await shell.dispose(); }
  });
}

test("new Shell.exec starts a fresh network scope at first curl admission", async context => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  let requests = 0;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(networkCommands({
    authorize: () => true, limits: { maxTotalTimeMs: 100 },
    async transport() {
      requests++;
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), async dispose() {} };
    },
  }));
  shell.register({ name: "advance", execute() { now += 500; return { exitCode: 0 }; } });
  try {
    assert.equal((await shell.exec(`advance; ${curl}`)).exitCode, 0);
    assert.equal((await shell.exec(`advance; ${curl}`)).exitCode, 0);
    assert.equal(requests, 2);
  } finally { await shell.dispose(); }
});

test("parallel pipeline curls share a deadline while concurrent Shell.exec is independent", async context => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const admissions = [gate<AbortSignal>(), gate<AbortSignal>(), gate<AbortSignal>()];
  const pending = gate<void>();
  let requests = 0;
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxWallClockMs: 600_000 } }).use(networkCommands({
    authorize: () => true, limits: { maxTotalTimeMs: 100 }, async transport(request) {
      admissions[requests++]!.resolve(request.signal);
      await pending.promise;
      return { status: 200, statusText: "OK", headers: [], body: toByteSource(""), async dispose() {} };
    },
  }));
  shell.register({ name: "step", async execute() {
    await admissions[0]!.promise;
    now += 60;
    context.mock.timers.tick(60);
    return { exitCode: 0 };
  } });
  try {
    const parallel = shell.exec(`${curl} | { step; ${curl}; }`);
    const first = await admissions[0]!.promise;
    const second = await admissions[1]!.promise;
    const concurrent = shell.exec(curl);
    const independent = await admissions[2]!.promise;
    now += 40;
    context.mock.timers.tick(40);
    const aborted = [first.aborted, second.aborted, independent.aborted];
    pending.resolve();
    const outcomes = await Promise.all([parallel, concurrent]);
    assert.deepEqual(aborted, [true, true, false]);
    assert.deepEqual(outcomes.map(outcome => outcome.exitCode), [28, 0]);
  } finally { pending.resolve(); await shell.dispose(); }
});

test("actual runtime contexts expose one frozen opaque token per exec", async () => {
  const scopes: (object | undefined)[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.register({ name: "capture", execute(context) { scopes.push(context.executionScope); return { exitCode: 0 }; } });
  try {
    await shell.exec("capture; sh -c capture; capture | capture");
    await shell.exec("capture");
    assert.equal(scopes.length, 5);
    assert.ok(scopes[0]);
    assert.equal(Object.isFrozen(scopes[0]), true);
    assert.deepEqual(Reflect.ownKeys(scopes[0]), []);
    for (const scope of scopes.slice(1, 4)) assert.equal(scope, scopes[0]);
    assert.notEqual(scopes[4], scopes[0]);
  } finally { await shell.dispose(); }
});
