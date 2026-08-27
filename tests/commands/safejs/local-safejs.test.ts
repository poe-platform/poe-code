import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import ts from "typescript";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { safeJsCommands, type SafeJsRuntime } from "../../../src/commands/safejs/index.js";
import { deferred, execute } from "./helpers.js";
import { localRoot, localRuntime, localSkip } from "./local-runtime.js";

function quote(source: string): string { return `'${source.replaceAll("'", "'\\''")}'`; }

test("actual local SafeJS factories are structurally assignable without private runtime dependencies", { skip: localSkip }, async context => {
  assert(localRoot);
  const filename = join(import.meta.dirname, "in-memory-type-probe.ts");
  const source = [
    `import { run } from ${JSON.stringify(join(localRoot, "src/run.js"))};`,
    `import { Budget } from ${JSON.stringify(join(localRoot, "src/interp/budget.js"))};`,
    `import { makeFsModule } from ${JSON.stringify(join(localRoot, "src/modules/fs.js"))};`,
    `import { declareHostOperation } from ${JSON.stringify(join(localRoot, "src/interp/host-bridge.js"))};`,
    'import { safeJsCommands, type SafeJsRuntime } from "../../../src/commands/safejs/index.js";',
    'const runtime: SafeJsRuntime<Budget> = { run, createBudget: options => new Budget(options), makeFsModule, declareHostOperation };',
    'void safeJsCommands({ runtime });',
  ].join("\n");
  const options: ts.CompilerOptions = { noEmit: true, strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, types: ["node"] };
  const host = ts.createCompilerHost(options);
  const getSource = host.getSourceFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.fileExists = path => path === filename || exists(path);
  host.getSourceFile = (path, version, onError, fresh) => path === filename ? ts.createSourceFile(path, source, version, true) : getSource(path, version, onError, fresh);
  const program = ts.createProgram([filename], options, host);
  const probe = program.getSourceFile(filename);
  assert(probe);
  assert.deepEqual([...program.getSyntacticDiagnostics(probe), ...program.getSemanticDiagnostics(probe)].map(value => ts.flattenDiagnosticMessageText(value.messageText, "\n")), []);
  for (const path of ["run.ts", "interp/budget.ts", "interp/host-bridge.ts", "modules/fs.ts"]) {
    context.diagnostic(`${path}: sha256=${createHash("sha256").update(await readFile(join(localRoot, "src", path))).digest("hex")}`);
  }
});

test("real SafeJS shares shell pipeline input, virtual files, argv, cwd and env", { skip: localSkip }, async () => {
  const runtime = await localRuntime();
  const fs = new MemoryFileSystem(); await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work", env: { KEY: "virtual" }, limits: { pipeHighWaterMark: 1 } }).use(standardCommands()).use(safeJsCommands({ runtime }));
  const source = 'import { readText, write } from "stdio"; import { writeFile } from "fs"; import { args, cwd, env } from "command"; const text = await readText(); await writeFile("shared", text + ":" + args[0]); await write(cwd + ":" + env.KEY + ":" + text);';
  const actual = await shell.exec(`printf 'é😀\\n' | safejs -e ${quote(source)} 'two words' | cat; cat shared`);
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout, "/work:virtual:é😀\né😀\n:two words");
  assert.equal(Buffer.from(await fs.readFile("/work/shared")).toString(), "é😀\n:two words");
});

test("real SafeJS script files use the virtual cwd, not the script directory", { skip: localSkip }, async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work/scripts", { recursive: true });
  await fs.writeFile("/work/scripts/tool.ajs", Buffer.from('import { readText } from "stdio"; import { writeFile } from "fs"; import { args } from "command"; await writeFile("result", await readText()); return args;'));
  const actual = await execute(["--print", "scripts/tool.ajs", "x", "--flag"], { runtime: await localRuntime() }, "input é", { fs });
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout.toString(), '["x","--flag"]\n');
  assert.equal(Buffer.from(await fs.readFile("/work/result")).toString(), "input é");
});

test("real SafeJS source stdin is single-use and guest byte IO stays exact", { skip: localSkip }, async () => {
  const runtime = await localRuntime();
  const source = 'import { readText, writeBytes } from "stdio"; if ((await readText()) !== "") throw new Error("stdin replay"); await writeBytes([0, 255, 195, 169, 240, 159, 152, 128]);';
  const result = await execute(["-"], { runtime }, source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.from([0, 255, 195, 169, 240, 159, 152, 128]));
});

test("real SafeJS console output and return-value printing do not escape to host console", { skip: localSkip }, async () => {
  const actual = await execute(["-p", "-e", 'console.log("hello", "é"); console.error("guest warning"); return { result: 3 };'], { runtime: await localRuntime() });
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout.toString(), 'hello é\n{"result":3}\n');
  assert.equal(actual.stderr, "guest warning\n");
});

for (const source of [
  'return process;', 'return require("node:fs");', 'return Function("return process")();',
  'return globalThis.process;', 'return ({}).constructor.constructor("return process")();',
  'import { readFile } from "node:fs/promises"; return await readFile("/etc/passwd", "utf8");',
  'import { readFile } from "fs"; return await readFile("/etc/passwd", "utf8");',
]) test(`real SafeJS denies ungranted host capability: ${source}`, { skip: localSkip }, async () => {
  const actual = await execute(["-p", "-e", source], { runtime: await localRuntime() });
  assert.notEqual(actual.exitCode, 0);
  assert.equal(actual.stdout.length, 0);
  assert.notEqual(actual.stderr, "");
});

test("real SafeJS parse, guest error, step budget, deadline and explicit status remain distinct", { skip: localSkip, timeout: 5000 }, async () => {
  const runtime = await localRuntime();
  for (const [source, expected, limits] of [
    ["const = ;", 2, {}], ['throw new Error("guest failure")', 1, {}],
    ["while (true) {}", 124, { maxSteps: 100 }],
    ["while (true) {}", 124, { maxSteps: 10_000_000, timeoutMs: 10 }],
    ['import { setExitCode } from "command"; setExitCode(23);', 23, {}],
  ] as const) {
    const actual = await execute(["-e", source], { runtime, limits });
    assert.equal(actual.exitCode, expected, actual.stderr);
  }
});

test("real SafeJS session effects persist only in VFS; module/env/cwd mutations do not leak", { skip: localSkip }, async () => {
  const fs = new MemoryFileSystem(); await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work", env: { KEY: "original" } }).use(standardCommands()).use(safeJsCommands({ runtime: await localRuntime() }));
  const source = 'import { env, args } from "command"; import { writeFile } from "fs"; env.KEY = "guest"; args.push("local"); await writeFile("persist", "yes"); throw "after effect";';
  const actual = await shell.exec(`safejs -e ${quote(source)}; printf '%s\\n' "$KEY"; pwd; cat persist`);
  assert.equal(actual.exitCode, 0);
  assert.equal(actual.stdout, "original\n/work\nyes");
  assert.match(actual.stderr, /after effect/u);
  const later = await shell.exec(`safejs -p -e ${quote('import { env, args } from "command"; return [env.KEY, args];')}`);
  assert.equal(later.stdout, '["original",[]]\n');
});

test("real SafeJS host-call journal marks consumed stdin/output and writes as effects", { skip: localSkip }, async () => {
  assert(localRoot);
  const bridge = await import(pathToFileURL(join(localRoot, "src/interp/host-bridge.ts")).href) as { readHostOperationPolicy(operation: unknown): string | undefined };
  const actualRuntime = await localRuntime();
  let snapshot: unknown;
  const runtime: SafeJsRuntime<object> = { ...actualRuntime, makeFsModule(options) {
    const module = actualRuntime.makeFsModule(options);
    assert.equal(bridge.readHostOperationPolicy(module.readFile), "re-issue");
    assert.equal(bridge.readHostOperationPolicy(module.writeFile), "read-side-effect");
    return module;
  }, async run(source, options) {
    const result = await actualRuntime.run(source, options);
    snapshot = Reflect.get(result, "snapshot");
    return result;
  } };
  const result = await execute(["-e", 'import { readText, write } from "stdio"; import { writeFile, readFile } from "fs"; await writeFile("copy", await readText()); await write(await readFile("copy", "utf8"));'], { runtime }, "data");
  assert.equal(result.exitCode, 0, result.stderr);
  assert(snapshot && typeof snapshot === "object");
  const calls = Reflect.get(snapshot, "hostCalls") as { moduleId: string; operation: string; policy: string }[];
  for (const [module, name, policy] of [["stdio", "readText", "read-side-effect"], ["stdio", "write", "read-side-effect"], ["fs", "writeFile", "read-side-effect"]]) {
    assert(calls.some(call => call.moduleId === module && call.operation === name && call.policy === policy), `${module}.${name}`);
  }
  assert.equal(calls.some(call => call.moduleId === "fs" && call.operation === "readFile"), false);
});

test("actual current engine preserves constructed Error messages with active cancellation", { skip: localSkip }, async context => {
  assert(localRoot);
  const module = await import(pathToFileURL(join(localRoot, "src/run.ts")).href) as { run(source: string, options?: { signal?: AbortSignal }): Promise<unknown> };
  const source = 'throw new Error("constructed");';
  await assert.rejects(module.run(source), { message: "constructed" });
  await assert.rejects(module.run(source, { signal: new AbortController().signal }), { message: "constructed" });
  const command = await execute(["-e", source], { runtime: await localRuntime() });
  assert.equal(command.exitCode, 1);
  assert.equal(command.stdout.length, 0);
  assert.equal(command.stderr, "safejs: constructed\n");
  context.diagnostic("Positive Error-message regression with cancellation enabled; the historical losing-constructor assertion remains in fa6c095/b4cde0b evidence.");
});

test("real SafeJS cancellation stops a pending guest read and later filesystem effects", { skip: localSkip, timeout: 2000 }, async () => {
  const entered = deferred();
  const blocked = deferred<IteratorResult<Uint8Array>>();
  let returned = 0;
  const input = { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return blocked.promise; },
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } };
  const fs = new MemoryFileSystem(); await fs.mkdir("/work");
  const controller = new AbortController();
  const reason = new Error("host cancelled SafeJS");
  const task = execute(["-e", 'import { readText } from "stdio"; import { writeFile } from "fs"; const text = await readText(); await writeFile("must-not-exist", text);'],
    { runtime: await localRuntime() }, input, { fs, signal: controller.signal });
  const rejected = assert.rejects(task, error => error === reason);
  await entered.promise;
  controller.abort(reason);
  await rejected;
  blocked.reject(new Error("late producer failure"));
  await delay(10);
  assert.equal(returned, 1);
  await assert.rejects(fs.lstat("/work/must-not-exist"), { code: "ENOENT" });
});

for (const source of [
  'import { write } from "stdio"; try { await write("too large"); } catch (error) {} return "recovered";',
  'import { writeBytes } from "stdio"; await writeBytes([1, 2, 3]);',
  'console.log("too large");', 'console.error("too large");',
]) test(`real SafeJS quota is fatal with no leaked rejection: ${source}`, { skip: localSkip }, async () => {
  const result = await execute(["-p", "-e", source], { runtime: await localRuntime(), limits: { maxOutputBytes: 2 } });
  assert.equal(result.exitCode, 124, result.stderr);
  assert.match(result.stderr, /maxOutputBytes/u);
  assert.equal(result.stdout.length, 0);
  await delay(5);
});

test("real SafeJS readonly fs denies mutations without reading host paths", { skip: localSkip }, async () => {
  const backing = new MemoryFileSystem(); await backing.mkdir("/work"); await backing.writeFile("/work/input", Buffer.from("virtual"));
  const fs = new ReadOnlyFileSystem(backing);
  const runtime = await localRuntime();
  const read = await execute(["-p", "-e", 'import { readFile } from "fs"; return await readFile("input", "utf8");'], { runtime }, "", { fs });
  assert.equal(read.exitCode, 0, read.stderr); assert.equal(read.stdout.toString(), "virtual\n");
  const write = await execute(["-e", 'import { writeFile } from "fs"; await writeFile("input", "corrupt");'], { runtime }, "", { fs });
  assert.equal(write.exitCode, 1); assert.match(write.stderr, /EROFS/u);
  assert.equal(Buffer.from(await backing.readFile("/work/input")).toString(), "virtual");
  assert.deepEqual((await backing.readdir("/work")).map(entry => entry.name), ["input"]);
});

test("real SafeJS repeated guest chunks compose as a binary streaming pipeline", { skip: localSkip }, async () => {
  const input = Buffer.from(Array.from({ length: 65539 }, (_, index) => index & 255));
  const source = 'import { readBytes, writeBytes } from "stdio"; let chunk = await readBytes(4096); while (chunk !== null) { await writeBytes(chunk); chunk = await readBytes(4096); }';
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { pipeHighWaterMark: 17 } }).use(standardCommands()).use(safeJsCommands({ runtime: await localRuntime() }));
  const output: Uint8Array[] = [];
  const result = await shell.exec(`cat | safejs -e ${quote(source)} | cat`, { stdin: input, stdout: { async write(bytes) { output.push(bytes.slice()); } } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Buffer.concat(output), input);
});

test("real SafeJS modules and environment have no ambient env or time imports", { skip: localSkip }, async () => {
  for (const source of ['import { get } from "env"; return get("HOME");', 'import { sleep } from "time"; await sleep(1);', 'import { exec } from "shell"; await exec("pwd");']) {
    const result = await execute(["-p", "-e", source], { runtime: await localRuntime() });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stdout.length, 0);
  }
});

test("real SafeJS respects enclosing shell output limits independently of its own budget", { skip: localSkip }, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(safeJsCommands({ runtime: await localRuntime() }));
  await assert.rejects(shell.exec(`safejs -e ${quote('import { write } from "stdio"; await write("too much output");')}`,
    { limits: { maxOutputBytes: 4 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});
