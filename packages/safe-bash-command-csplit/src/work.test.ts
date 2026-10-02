import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { Budget, settings } from "./internal.js";
import { Lifecycle, Lines } from "./io.js";
import { createCsplitCommand } from "./index.js";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import type { BoundedRegexProvider, RegexWorkerRequest } from "safe-bash-regex-engine/execution/provider";
import { exprMatchCeilings } from "safe-bash-regex-engine/execution/protocol";

function context(fs: MemoryFileSystem, args: string[], input: string): CommandContext {
  return { fs, command: "csplit", args, cwd: "/", env: { LC_ALL: "C" }, signal: new AbortController().signal,
    stdin: toByteSource(input), stdout: { async write() {} }, stderr: { async write() {} } };
}

test("a large producer chunk yields repeatedly during line scanning", async () => {
  const fs = new MemoryFileSystem();
  const invocation = context(fs, ["-", "1"], "a\n".repeat(32_768));
  let checkpoints = 0;
  registerYieldCheckpoint(invocation.signal, () => { checkpoints++; });
  const lifecycle = new Lifecycle(new Budget(invocation, settings({})));
  try { assert.deepEqual(await new Lines(lifecycle).get(1), Uint8Array.of(97, 10)); }
  finally { await lifecycle.close(); }
  assert.ok(checkpoints >= 16, `Only ${checkpoints} checkpoints while scanning 64KiB`);
});

for (const maximum of [5000, 67_108_864]) test(`BRE requests share command work under ${maximum}`, async () => {
  const fs = new MemoryFileSystem();
  const requests: RegexWorkerRequest[] = [];
  const provider = createBoundedRegexProvider();
  const observed: BoundedRegexProvider = { createWorker(options) {
    const worker = provider.createWorker(options);
    return new Proxy(worker, { get(target, key, receiver) {
      if (key === "postMessage") return (request: RegexWorkerRequest) => { requests.push(request); worker.postMessage(request); };
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
  const result = await createCsplitCommand({ regexExecutor: observed, limits: { maxWork: maximum } }).execute(context(fs, ["-", "/a/", "{*}"], "a\n".repeat(8)));
  assert.equal(result.exitCode, 0);
  assert.ok(requests.length >= 9);
  let previous = maximum + 1;
  for (const request of requests) {
    assert.equal(request.descriptor.kind, "bre-search");
    if (request.descriptor.kind !== "bre-search") throw new Error("wrong operation");
    const steps = request.descriptor.limits.maxSteps;
    assert.ok(steps <= exprMatchCeilings.maxSteps);
    if (maximum < exprMatchCeilings.maxSteps) assert.ok(steps < previous);
    previous = steps;
  }
});

test("late malformed BRE is compiled before any output acquisition", async () => {
  const fs = new MemoryFileSystem();
  let writes = 0;
  const view = new Proxy(fs, { get(target, key, receiver) {
    if (key === "writeFile") return async () => { writes++; throw new Error("unexpected write"); };
    const value: unknown = Reflect.get(target, key, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  assert.equal((await createCsplitCommand().execute(context(view, ["-", "/a/", "/[/"], "a\nb\n"))).exitCode, 1);
  assert.equal(writes, 0);
});
