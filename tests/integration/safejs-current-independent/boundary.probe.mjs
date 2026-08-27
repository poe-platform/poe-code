import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryFileSystem, Shell, createSafeJsCommands, safeJsCommands, standardCommands, toByteSource, makeSafeJsShellModule } from "virtual-bash";

assert.ok(process.env.SAFEJS_LOCAL_ROOT, "Actual copied SafeJS required; no skip or fixture substitute");
const load = filename => import(pathToFileURL(join(process.env.SAFEJS_LOCAL_ROOT, "src", filename)).href);
const { run } = await load("run.ts"), { Budget } = await load("interp/budget.ts");
const { makeFsModule } = await load("modules/fs.ts"), { declareHostOperation } = await load("interp/host-bridge.ts");
const runtime = { run, createBudget: options => new Budget(options), makeFsModule, declareHostOperation };
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const keys = ["__proto__", "constructor", "prototype", "toString", "toLocaleString", "hasOwnProperty", "valueOf", "__defineGetter__", "雪"];
const entries = keys.map((key, index) => [key, `value-${index}-é😀`]);
function dictionary(nullPrototype) {
  const result = nullPrototype ? Object.create(null) : {};
  for (const [key, value] of entries) Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
  return result;
}
async function memory() { const fs = new MemoryFileSystem(); await fs.mkdir("/work"); return fs; }
async function execute(source, options = {}) {
  const stdout = [], stderr = [];
  const context = { command: "safejs", args: options.args ?? ["-p", "-e", source], cwd: "/work", fs: options.fs ?? await memory(), env: options.env ?? {},
    signal: options.signal ?? new AbortController().signal, stdin: options.stdin ?? toByteSource(""),
    stdout: options.stdout ?? { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: options.stderr ?? { async write(bytes) { stderr.push(bytes.slice()); } } };
  const [definition] = createSafeJsCommands({ runtime: options.runtime ?? runtime, ...(options.limits ? { limits: options.limits } : {}) });
  const result = await definition.execute(context);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), fs: context.fs };
}
function returned(result, expected) { assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, ""); assert.deepEqual(JSON.parse(result.stdout.toString()), expected); }

for (const nullPrototype of [false, true]) {
  for (const [key, expected] of entries) test(`INDEPENDENT own dictionary ${nullPrototype ? "null" : "plain"} key ${key}`, async () => {
    const env = Object.freeze(dictionary(nullPrototype)), descriptors = Object.getOwnPropertyDescriptors(env);
    returned(await execute(`import { env } from "command"; return [env[${JSON.stringify(key)}]];`, { env }), [expected]);
    assert.deepEqual(Object.getOwnPropertyDescriptors(env), descriptors); assert.equal(Object.getPrototypeOf(env), nullPrototype ? null : Object.prototype);
  });
  test(`INDEPENDENT dictionary ${nullPrototype ? "null" : "plain"} keys enumerate as data`, async () => {
    returned(await execute('import { env } from "command"; return Object.keys(env).sort();', { env: dictionary(nullPrototype) }), [...keys].sort());
  });
}

test("INDEPENDENT inherited environment properties are not promoted", async () => {
  const env = Object.create({ INHERITED: "not exported" }); env.OWN = "exported";
  returned(await execute('import { env } from "command"; return [Object.keys(env), env.OWN, env.INHERITED];', { env }), [["OWN"], "exported", null]);
  assert.equal(env.INHERITED, "not exported"); assert.equal(Object.hasOwn(env, "INHERITED"), false);
});

test("INDEPENDENT empty environment does not acquire Object methods or host exports", async () => {
  returned(await execute('import { env } from "command"; return [Object.keys(env), typeof env.toString, typeof env.constructor, typeof env.HOME];', { env: Object.create(null) }), [[], "undefined", "undefined", "undefined"]);
});

test("INDEPENDENT guest mutation remains local across command invocations", async () => {
  const env = dictionary(false), original = Object.getOwnPropertyDescriptors(env);
  returned(await execute('import { env } from "command"; env.__proto__ = "guest-only"; env.constructor = "guest-ctor"; env.NEW = "guest-new"; return [env.__proto__, env.constructor, env.NEW];', { env }), ["guest-only", "guest-ctor", "guest-new"]);
  assert.deepEqual(Object.getOwnPropertyDescriptors(env), original);
  returned(await execute('import { env } from "command"; return [env.__proto__, env.constructor, env.NEW];', { env }), [entries[0][1], entries[1][1], null]);
});

test("INDEPENDENT command snapshots environment and argv before real runner invocation", async () => {
  const env = dictionary(true), args = ["-p", "-e", 'import { env, args, cwd } from "command"; return [env.__proto__, args, cwd];', "--", "original", "é😀"];
  let observed;
  const watched = { ...runtime, run(source, options) { observed = options.modules.command; env.__proto__ = "host-later"; args[args.length - 1] = "host-later"; return run(source, options); } };
  returned(await execute("", { env, args, runtime: watched }), [entries[0][1], ["original", "é😀"], "/work"]);
  assert.equal(observed.env.__proto__, entries[0][1]); assert.equal(Object.getPrototypeOf(observed.env), null); assert.equal(env.__proto__, "host-later");
});

test("INDEPENDENT shell env replacement and multi-byte pipeline use public command", async () => {
  const fs = await memory(), shell = new Shell({ fs, cwd: "/work", env: { PARENT: "retained" } }).use(standardCommands()).use(safeJsCommands({ runtime }));
  try {
    const source = 'import { env } from "command"; import { readText, write } from "stdio"; await write(JSON.stringify([env.__proto__, env.constructor, env.toString, env.PARENT, await readText()]));';
    const result = await shell.exec(`printf 'é😀' | env -i __proto__=literal constructor=ctor toString=text safejs -e ${quote(source)} | cat`);
    assert.equal(result.exitCode, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), ["literal", "ctor", "text", null, "é😀"]);
    const parent = await shell.exec('printf "%s" "$PARENT"'); assert.equal(parent.stdout, "retained");
  } finally { await shell.dispose(); }
});

test("INDEPENDENT virtual file source, special filenames, and next invocation effects", async () => {
  const fs = await memory(); await fs.writeFile("/work/__proto__", Buffer.from('\uFEFFimport { writeFile } from "fs"; import { args, env } from "command"; await writeFile("constructor", env.toString + ":" + args[0], "utf8"); return 7;'));
  const result = await execute("", { fs, env: dictionary(false), args: ["-p", "/work/__proto__", "argument"] }); returned(result, 7);
  returned(await execute('import { readFile } from "fs"; return [await readFile("constructor", "utf8")];', { fs }), [entries[3][1] + ":argument"]);
});

for (const limit of [5, 6]) test(`INDEPENDENT UTF8 input byte threshold ${limit}`, async () => {
  const fs = await memory(); const bytes = Buffer.from("é😀");
  const stdin = { async *[Symbol.asyncIterator]() { yield bytes.subarray(0, 1); yield bytes.subarray(1, 4); yield bytes.subarray(4); } };
  const result = await execute('import { readText } from "stdio"; import { writeFile } from "fs"; const value = await readText(); await writeFile("after", value, "utf8"); return [value];', { fs, stdin, limits: { maxInputBytes: limit } });
  if (limit === 6) { returned(result, ["é😀"]); assert.equal(Buffer.from(await fs.readFile("/work/after")).toString(), "é😀"); }
  else { assert.equal(result.exitCode, 124, result.stderr); assert.equal(result.stdout.length, 0); assert.match(result.stderr, /maxInputBytes/); assert.deepEqual(await fs.readdir("/work"), []); }
});

test("INDEPENDENT output quota combines channels and prevents later effects", async () => {
  const fs = await memory();
  const result = await execute('import { write, error } from "stdio"; import { writeFile } from "fs"; await write("é"); try { await error("😀"); } catch (failure) {} await writeFile("after", "wrong");', { fs, limits: { maxOutputBytes: 5 } });
  assert.equal(result.exitCode, 124, result.stderr); assert.equal(result.stdout.toString(), "é"); assert.match(result.stderr, /maxOutputBytes/); assert.equal(result.stderr.includes("😀"), false); assert.deepEqual(await fs.readdir("/work"), []);
});

test("INDEPENDENT pending input deadline closes iterator and prevents publication", async () => {
  let reads = 0, closes = 0; const fs = await memory();
  const stdin = { [Symbol.asyncIterator]() { return { next() { reads++; return new Promise(() => {}); }, async return() { closes++; return { done: true }; } }; } };
  const result = await execute('import { readText } from "stdio"; import { writeFile } from "fs"; await readText(); await writeFile("after", "wrong");', { fs, stdin, limits: { timeoutMs: 250 } });
  assert.equal(result.exitCode, 124, result.stderr); assert.match(result.stderr, /timeoutMs/); assert.equal(reads, 1); assert.equal(closes, 1); assert.deepEqual(await fs.readdir("/work"), []);
});

for (const reason of [0, "", Symbol("reason")]) test(`INDEPENDENT preabort exact ${typeof reason} reason leaves runner untouched`, async () => {
  const signal = AbortSignal.abort(reason); let calls = 0;
  const watched = { ...runtime, run(...args) { calls++; return run(...args); } };
  await assert.rejects(execute("return 1;", { signal, runtime: watched }), error => Object.is(error, reason)); assert.equal(calls, 0);
});

test("INDEPENDENT delayed stdin rejection after caller cancellation stays observed", async () => {
  const controller = new AbortController(), reason = new Error("independent-stop"); let reads = 0, closes = 0;
  let rejectRead, announce; const started = new Promise(resolve => { announce = resolve; }); const fs = await memory();
  const stdin = { [Symbol.asyncIterator]() { return { next() { reads++; announce(); return new Promise((_resolve, reject) => { rejectRead = reject; }); }, async return() { closes++; return { done: true }; } }; } };
  const pending = execute('import { readText } from "stdio"; import { writeFile } from "fs"; try { await readText(); } catch (failure) {} await writeFile("after", "wrong");', { fs, stdin, signal: controller.signal });
  const checked = assert.rejects(pending, error => error === reason); await started; controller.abort(reason); await checked; rejectRead(new Error("late host error")); await delay(40);
  assert.equal(reads, 1); assert.equal(closes, 1); assert.deepEqual(await fs.readdir("/work"), []);
});

test("INDEPENDENT guest exception preserves ordered output and existing file effects", async () => {
  const fs = await memory(); const result = await execute('import { write } from "stdio"; import { writeFile } from "fs"; await writeFile("before", "kept"); await write("é"); throw new Error("specific failure");', { fs });
  assert.equal(result.exitCode, 1); assert.equal(result.stdout.toString(), "é"); assert.equal(result.stderr, "safejs: specific failure\n"); assert.equal(Buffer.from(await fs.readFile("/work/before")).toString(), "kept");
});

test("INDEPENDENT parse error occurs before any guest file effect", async () => {
  const fs = await memory(); const result = await execute('import { writeFile } from "fs"; await writeFile("after", "wrong"); const = ;', { fs });
  assert.equal(result.exitCode, 2, result.stderr); assert.equal(result.stdout.length, 0); assert.deepEqual(await fs.readdir("/work"), []);
});

test("INDEPENDENT guest lacks ambient host evaluation and process bindings", async () => {
  returned(await execute("return [typeof process, typeof require, typeof Function, typeof eval];"), ["undefined", "undefined", "undefined", "undefined"]);
});

test("INDEPENDENT standalone shell bridge preserves own-key options at real shell boundary", async () => {
  const fs = await memory(), shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()), controller = new AbortController(); let calls = 0;
  const bridge = makeSafeJsShellModule((source, options) => { calls++; return shell.exec(source, options); }, { fs, cwd: "/work", signal: controller.signal, replayPolicy: "read-side-effect", declareHostOperation });
  try {
    const serialized = JSON.stringify(Object.fromEntries(entries));
    const result = await run(`import { exec } from "shell"; const result = await exec('printf "%s|%s|%s" "$__proto__" "$constructor" "$toString"', {env: JSON.parse(${JSON.stringify(serialized)})}); return [result.stdout, result.stderr, result.exitCode];`, { modules: { shell: bridge }, signal: controller.signal });
    assert.equal(result.ok, true); assert.deepEqual(result.returnValue, [entries[0][1] + "|" + entries[1][1] + "|" + entries[3][1], "", 0]); assert.equal(calls, 1);
  } finally { await shell.dispose(); }
});
