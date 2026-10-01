import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { Interpreter } from "safe-bash-query-engine/interpreter";
import { Budget } from "safe-bash-query-engine/limits";
import { registerRuntimeBackingFileSystem } from "safe-bash-contracts/runtime-control";
import { createJqCommand } from "./index.js";

test("jq behavior works through the standalone portable factory", async () => {
 const values = createCommandArguments(["."]);
 let output = "";
 const result = await createJqCommand().execute({
  command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource("{}"),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.equal(output, "{}\n");
});

for (const [filter, input, expected] of [
 ['[test("a"; "i"), (match("a"; "i") | .offset), ([scan("a"; "i")] | length), ([splits("a"; "i")] | length)]', '"Aa"', '[true,0,2,3]\n'],
 ['[nth(1; range(3)), isempty(empty), ("x" | in({x:1})), IN(1,2), (INDEX(.[]; tostring) | keys), pick(.[1]), (9|sqrt), (0|todate)]', '[1,2]', '[1,true,true,false,["1","2"],[null,2],3,"1970-01-01T00:00:00Z"]\n'],
 ['def f($n): if $n == 0 then 1 else $n * f($n - 1) end; f(5)', 'null', '120\n'],
 ['(def f: . + 10; f) + (def f: . + 20; f)', '1', '32\n'],
 ['sub("(?<n>[0-9]+)"; "num:\\(.n)")', '"id=42"', '"id=num:42"\n'],
 ['strptime("%FT%TZ") | mktime | gmtime | strftime("%F")', '"2024-02-29T00:00:00Z"', '"2024-02-29"\n'],
] as const) {
 test(`jq compiles and executes shared language features: ${filter}`, async () => {
  const values = createCommandArguments(["-c", filter]);
  let stdout = "";
  let stderr = "";
  const result = await createJqCommand().execute({
   command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs: createMemoryFileSystem(), stdin: toByteSource(input),
   stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  assert.equal(stdout, expected);
 });
}

for (const scenario of ["slurp", "fallback", "async output"] as const) test(`jq ${scenario} preserves values and releases reusable state`, async t => {
 const fs = createMemoryFileSystem();
 registerRuntimeBackingFileSystem(fs, fs);
 // Disable the direct byte-view path while retaining the real streaming reader.
 fs.readFile = fs.readFile.bind(fs);
 await fs.writeFile("/data.jsonl", new TextEncoder().encode('{"id":1}\n{"id":2}\n{"id":3}\n'));
 let yielded = false;
 const tick = Budget.prototype.tickSync;
 if (scenario === "slurp") t.mock.method(Budget.prototype, "tickSync", function (this: Budget, ...args: Parameters<Budget["tickSync"]>) {
  if (!yielded) { yielded = true; return Promise.resolve(); }
  return tick.apply(this, args);
 });
 const scratchResults: boolean[] = [];
 const tryRunSync = Interpreter.prototype.tryRunSync;
 const attempts = t.mock.method(Interpreter.prototype, "tryRunSync", function (this: Interpreter, ...args: Parameters<Interpreter["tryRunSync"]>) {
  const result = tryRunSync.apply(this, args);
  if (result) scratchResults.push(this.getScratchKeys(result[0]!) !== undefined);
  return result;
 });
 const values = createCommandArguments(scenario === "slurp" ? ["-cs", ".", "/data.jsonl"] : scenario === "fallback" ? ["-c", "[.id]"] : ["-cS", "{id: .id}"]);
 let stdout = "", stderr = "";
 const result = await createJqCommand().execute({
  command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
  stdin: toByteSource('{"id":1}\n{"id":2}\n{"id":3}\n'),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, stderr);
 assert.equal(stderr, "");
 assert.equal(stdout, scenario === "slurp" ? '[{"id":1},{"id":2},{"id":3}]\n' : scenario === "fallback" ? '[1]\n[2]\n[3]\n' : '{"id":1}\n{"id":2}\n{"id":3}\n');
 if (scenario === "slurp") assert.equal(yielded, true);
 if (scenario === "fallback") assert.equal(attempts.mock.callCount(), 3);
 if (scenario === "async output") {
  assert.deepEqual(scratchResults, [true, true, true]);
 }
});
