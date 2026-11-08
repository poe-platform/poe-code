import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import reference from "./fixtures/prompt-query-reference.json" with { type: "json" };
import { selectLlmModelByQuery } from "./model-selection.js";
import { createLlmService } from "./service.js";
import { createLlmCommand } from "./command.js";
import { createLlmConfiguration } from "./configuration.js";

async function run(args: string[], alias = false) {
  const fs = new MemoryFileSystem();
  const signal = new AbortController().signal;
  if (alias) await createLlmConfiguration({ fs, cwd: "/", env: {}, signal }).setAlias("speed", "long-alpha");
  let reads = 0;
  const calls: string[] = [], stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const command = createLlmCommand({ defaultModel: "long-alpha", providers: [{ name: "Fixture", models: [
    { id: "long-alpha", aliases: ["fast"] }, { id: "beta", aliases: ["fast-b"] }, { id: "zeta", aliases: ["fast-z"] },
  ], async *complete(request) { calls.push(request.model); yield request.model; } }] });
  const result = await command.execute({ command: "llm", args, fs, cwd: "/", env: {}, signal,
    stdin: { async *[Symbol.asyncIterator]() { reads++; yield* toByteSource(""); } },
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
  });
  return { code: result.exitCode, calls, reads, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

test("prompt queries select the shortest matching id with stable catalog ties", async () => {
  for (const args of [["-q", "FAST", "hello"], ["prompt", "--query=fast", "hello"], ["-qfast", "-q", "Fixture", "hello"]]) {
    const result = await run(args);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.calls, ["beta"]);
  }
});
test("query aliases include persisted aliases and repeated queries intersect", async () => {
  const result = await run(["-q", "speed", "-q", "alpha", "hello"], true);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.calls, ["long-alpha"]);
});
test("explicit models override even unmatched queries", async () => {
  const result = await run(["-q", "missing", "-m", "zeta", "hello"]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.calls, ["zeta"]);
});
test("unmatched queries fail before input or provider admission", async () => {
  const result = await run(["-q", "missing", "-q", "other", "hello"]);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "Error: No model found matching queries missing, other\n");
  assert.equal(result.reads, 0);
  assert.deepEqual(result.calls, []);
});

test("prompt query output and diagnostics match all pinned reference cases", async () => {
  for (const fixture of reference.cases) {
    const result = await run(fixture.argv, true);
    assert.equal(result.code, fixture.exitCode);
    assert.equal(result.stdout, fixture.stdout);
    assert.equal(result.stderr, fixture.stderr);
  }
});
test("SDK model query selection counts Unicode code points and observes cancellation", async () => {
  const service = createLlmService({ providers: [{ name: "Fixture", models: [{ id: "abc" }, { id: "😀😀" }], complete() { throw new Error("not called"); } }] });
  assert.equal((await selectLlmModelByQuery(service.models, ["Fixture"])).model.id, "😀😀");
  await assert.rejects(selectLlmModelByQuery(service.models, []), /requires a query/);
  const reason = new Error("cancelled");
  await assert.rejects(selectLlmModelByQuery(service.models, ["Fixture"], {}, AbortSignal.abort(reason)), error => error === reason);
});
