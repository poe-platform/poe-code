import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { execute } from "../safejs/helpers.js";
import { localRoot, localRuntime, localSkip } from "../safejs/local-runtime.js";

for (const [expression, expected] of [
  ['new Error("constructed").message', "constructed"],
  ['new TypeError("constructed").message', "constructed"],
  ['new Map([["key", "value"]]).get("key")', "value"],
  ['new Set(["value"]).has("value")', true],
  ['new RegExp("^value$").test("value")', true],
  ["Array.isArray([])", true],
  ["Array.from([1, 2])", [1, 2]],
] as const) {
  test(`UNRESOLVED desired live-signal plugin behavior: ${expression}`, { skip: localSkip }, async () => {
    const result = await execute(["-p", "-e", `return ${expression};`], { runtime: await localRuntime() });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString(), `${typeof expected === "string" ? expected : JSON.stringify(expected)}\n`);
  });
}

test("UNRESOLVED desired live-signal plugin behavior: own __proto__ environment data", { skip: localSkip }, async () => {
  const env = Object.fromEntries([["__proto__", "literal"]]);
  const result = await execute(["-p", "-e", 'import { env } from "command"; return env["__proto__"];'], { runtime: await localRuntime() }, "", { env });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), "literal\n");
});

test("UNRESOLVED desired raw engine behavior: pre-aborted pure run rejects original reason", { skip: localSkip }, async () => {
  assert(localRoot);
  const module = await import(pathToFileURL(join(localRoot, "src/run.ts")).href) as {
    run(source: string, options: { signal: AbortSignal }): Promise<unknown>;
  };
  const reason = new Error("already cancelled");
  await assert.rejects(module.run("return 42;", { signal: AbortSignal.abort(reason) }), error => error === reason);
});
