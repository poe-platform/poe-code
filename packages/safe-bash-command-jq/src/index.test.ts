import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { Interpreter } from "safe-bash-query-engine/interpreter";
import { Budget } from "safe-bash-query-engine/limits";
import { registerRuntimeBackingFileSystem } from "safe-bash-contracts/runtime-control";
import { createJqCommand } from "./index.js";

for (const decline of [false, true]) test(`jq owns sync output and charges one read (decline=${decline})`, async () => {
 const fs = createMemoryFileSystem();
 const retained: Uint8Array[] = [];
 let charges = 0, attempts = 0;
 const stdout = {
  writeSync(bytes: Uint8Array) { attempts++; if (decline) return false; retained.push(bytes); return true; },
  async write(bytes: Uint8Array) { retained.push(bytes); },
 };
 const command = createJqCommand();
 for (const x of [1, 8]) {
  await fs.writeFile("/in", new TextEncoder().encode(`{"x":${x}}\n`));
  const values = createCommandArguments(["-c", "{a: (.x + 1)}", "/in"]);
  const context = {
   command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
   _fastMemoryBackingFs: fs, _chargeFastFsOp() { charges++; },
   stdin: toByteSource(""), stdout, stderr: { async write() {} }, signal: new AbortController().signal,
  };
  assert.equal((await command.execute(context)).exitCode, 0);
 }
 assert.equal(attempts, 2);
 assert.equal(charges, 2);
 assert.deepEqual(retained.map(bytes => new TextDecoder().decode(bytes)), ['{"a":2}\n', '{"a":9}\n']);
});

for (const outputLimit of [{ maxOutputBytes: 5 }, { maxResults: 1 }]) {
 for (const value of ["aaaaaaaa", "éééé"]) test(`jq checks value limits before ${JSON.stringify(outputLimit)} for ${value}`, async () => {
  let stderr = "";
  const values = createCommandArguments(["-rn", `${"maxResults" in outputLimit ? '"",' : ""}${JSON.stringify(value)}`]);
  const result = await createJqCommand({ limits: { maxValueBytes: 7, ...outputLimit } }).execute({
   command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: createMemoryFileSystem(),
   stdin: toByteSource(""), stdout: { async write() {} },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }, signal: new AbortController().signal,
  });
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("maxValueBytes"), stderr);
 });
}

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

for (const decline of [false, true]) test(`jq fast output owns bytes and charges one read (decline=${decline})`, async () => {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/a", new TextEncoder().encode('{"x":1}\n'));
 await fs.writeFile("/b", new TextEncoder().encode('{"x":8}\n'));
 const retained: Uint8Array[] = [];
 let charges = 0;
 const command = createJqCommand();
 for (const file of ["/a", "/b"]) {
  const values = createCommandArguments(["-c", "{a: (.x + 1)}", file]);
  const context = {
   command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
   _fastMemoryBackingFs: fs, _chargeFastFsOp() { charges++; },
   stdin: toByteSource(""), signal: new AbortController().signal,
   stdout: { writeSync(bytes: Uint8Array) { if (decline) return false; retained.push(bytes); return true; },
    async write(bytes: Uint8Array) { retained.push(bytes); } },
   stderr: { async write(bytes: Uint8Array) { assert.fail(new TextDecoder().decode(bytes)); } },
  };
  assert.equal((await command.execute(context)).exitCode, 0);
 }
 assert.deepEqual(retained.map(bytes => new TextDecoder().decode(bytes)), ['{"a":2}\n', '{"a":9}\n']);
 assert.equal(charges, 2);
});

for (const value of ["aaaaaaaa", "éééé"]) test(`jq value limit precedes output limit for ${value}`, async () => {
 const values = createCommandArguments(["-rn", JSON.stringify(value)]);
 let stderr = "";
 const result = await createJqCommand({ limits: { maxValueBytes: 7, maxOutputBytes: 5 } }).execute({
  command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: createMemoryFileSystem(),
  stdin: toByteSource(""), signal: new AbortController().signal,
  stdout: { async write() { assert.fail("unexpected output"); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
 });
 assert.notEqual(result.exitCode, 0);
 assert.match(stderr, /maxValueBytes/);
});

for (const separateFileSystem of [false, true]) test(`jq select/project reads reused input bytes and retains owned output (separate filesystem=${separateFileSystem})`, async () => {
 const encoder = new TextEncoder();
 const decoder = new TextDecoder();
 const original = '{"active":true,"id":0,"val":"item_0000000000"}\n'.repeat(128);
 const reused = encoder.encode(original);
 const probes = [0, reused.length >> 1, reused.length - 1];
 const before = probes.map(index => reused[index]);
 const firstFs = createMemoryFileSystem();
 const secondFs = separateFileSystem ? createMemoryFileSystem() : firstFs;
 const retained: Uint8Array[] = [];
 let reads = 0;
 let writes = 0;
 const command = createJqCommand();
 for (const [fs, file] of [[firstFs, "/first.jsonl"], [secondFs, "/second.jsonl"]] as const) {
  if (file === "/second.jsonl") {
   reused.set(encoder.encode("ZZZZ_9999999999"), original.indexOf("item_0000000000"));
   assert.deepEqual(probes.map(index => reused[index]), before);
  }
  await fs.writeFile(file, reused);
  assert.equal(decoder.decode(await fs.readFile(file)), decoder.decode(reused));
  const values = createCommandArguments(["-c", "select(.active) | {id, val}", file]);
  const context = {
   command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
   _fastMemoryBackingFs: fs, _chargeFastFsOp() { reads++; },
   stdin: toByteSource(""), signal: new AbortController().signal,
   stdout: {
    writeSync(bytes: Uint8Array) { writes++; retained.push(bytes); return true; },
    async write() { assert.fail("expected synchronous select/project output"); },
   },
   stderr: { async write(bytes: Uint8Array) { assert.fail(decoder.decode(bytes)); } },
  };
  assert.equal((await command.execute(context)).exitCode, 0);
 }
 assert.equal(reads, 2);
 assert.equal(writes, 2);
 assert.deepEqual(retained.map(bytes => decoder.decode(bytes)), [
  '{"id":0,"val":"item_0000000000"}\n'.repeat(128),
  '{"id":0,"val":"ZZZZ_9999999999"}\n' + '{"id":0,"val":"item_0000000000"}\n'.repeat(127),
 ]);
 assert.equal(decoder.decode(await firstFs.readFile("/first.jsonl")), original);
});

test("jq declines a spent select/project budget before trying another synchronous parser", async t => {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/fallback.jsonl", new TextEncoder().encode('{"fallback":true,"id":7}\n'));
 const step = Budget.prototype.step;
 const candidates = new WeakSet<Budget>();
 const declined = new WeakSet<Budget>();
 let didDecline = false;
 let chargedAfterDecline = false;
 t.mock.method(Budget.prototype, "step", function (this: Budget, count = 1) {
  if (count === 16 && this.inputBytes === 0) candidates.add(this);
  if (declined.has(this)) chargedAfterDecline = true;
  return step.call(this, count);
 });
 const tick = Budget.prototype.tickSync;
 t.mock.method(Budget.prototype, "tickSync", function (this: Budget, count = 1) {
  // Select/project charges the complete row before its final checkpoint.
  if (!didDecline && candidates.has(this)) {
   declined.add(this);
   didDecline = true;
   return Promise.resolve();
  }
  return tick.call(this, count);
 });
 const values = createCommandArguments(["-c", "select(.fallback) | {id}", "/fallback.jsonl"]);
 let output = "";
 const context = {
  command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
  _fastMemoryBackingFs: fs, stdin: toByteSource(""), signal: new AbortController().signal,
  stdout: { writeSync(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); return true; },
   async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes: Uint8Array) { assert.fail(new TextDecoder().decode(bytes)); } },
 };
 const result = await createJqCommand().execute(context);
 assert.equal(result.exitCode, 0);
 assert.equal(output, '{"id":7}\n');
 assert.ok(didDecline, "must exercise a charged speculative attempt");
 assert.equal(chargedAfterDecline, false, "a declined attempt must not charge another parser to its budget");
});

test("jq supports --version, -V, --help, and -h", async () => {
 const fsMem = createMemoryFileSystem();
 const command = createJqCommand();
 for (const [flag, expectedPrefix] of [
  ["--version", "jq-1.7.1\n"],
  ["-V", "jq-1.7.1\n"],
  ["--help", "jq - commandline JSON processor"],
  ["-h", "jq - commandline JSON processor"],
 ] as const) {
  const values = createCommandArguments([flag]);
  let stdout = "";
  let stderr = "";
  const result = await command.execute({
   command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: fsMem,
   stdin: toByteSource(""), signal: new AbortController().signal,
   stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(stderr, "");
  assert.ok(stdout.startsWith(expectedPrefix), `expected ${flag} stdout to start with ${expectedPrefix}, got ${stdout}`);
 }
});

for (const [args, input, expected] of [
 [["-Rnc", '[inputs | split(",")]'], "a,b\nc,d\n", '[["a","b"],["c","d"]]\n'],
 [["-nsc", "[inputs]"], "1 2 3", '[[1,2,3]]\n'],
 [["-nc", "[limit(1; inputs)], [inputs]"], "1 2 3", '[1]\n[2,3]\n'],
 [["-nc", "[inputs]"], "1 2 3", '[1,2,3]\n'],
 [["-c", "[., inputs]"], "1 2 3", '[1,2,3]\n'],
 [["-Rnc", "def rows: inputs; [rows]"], "a\n\nb", '["a","","b"]\n'],
 [["-Rnc", "[inputs]"], "", '[]\n'],
] as const) test(`jq consumes shared input: ${args.join(" ")}`, async () => {
 const values = createCommandArguments([...args]);
 let stdout = "", stderr = "";
 const result = await createJqCommand().execute({
  command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(input),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, stderr);
 assert.equal(stdout, expected);
});

for (const limits of [{}, { maxInputBytes: 2 }, { maxCollectionSize: 1 }]) test(`jq inputs reads bounded virtual files: ${JSON.stringify(limits)}`, async () => {
 const fs = createMemoryFileSystem();
 await fs.writeFile("/a", new TextEncoder().encode("1\n"));
 await fs.writeFile("/b", new TextEncoder().encode("2\n"));
 const values = createCommandArguments(["-nc", "[inputs]", "/a", "/b"]);
 let stdout = "", stderr = "";
 const result = await createJqCommand({ limits }).execute({
  command: "jq", args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
  stdin: toByteSource(""),
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 if (Object.keys(limits).length) {
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes(Object.keys(limits)[0]!), stderr);
 } else {
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stdout, "[1,2]\n");
 }
});
