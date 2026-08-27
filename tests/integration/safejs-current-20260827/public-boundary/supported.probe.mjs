import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createNodeFsBridge, makeSafeJsFsModule, makeSafeJsShellModule,
  safeJsCommands, Shell, standardCommands,
} from "virtual-bash";
import { Budget, command, declareHostOperation, makeFsModule, memory, quote, rejected, run, runtime } from "./helpers.mjs";

const specialEnv = () => Object.fromEntries([["__proto__", "literal"], ["constructor", "ctor"], ["prototype", "proto"], ["NORMAL", "ok"]]);

test("PUBLIC command metadata preserves own special-name environment data", async () => {
  const env = specialEnv();
  const before = Object.getOwnPropertyDescriptors(env);
  const result = await command('import { env } from "command"; return [env["__proto__"], env.constructor, env.prototype, env.NORMAL];', { env });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), '["literal","ctor","proto","ok"]\n');
  assert.deepEqual(Object.getOwnPropertyDescriptors(env), before);
  assert.equal(Object.getPrototypeOf(env), Object.prototype);
});

test("PUBLIC safeJsCommands registration preserves special env through a shell pipeline", async () => {
  const fs = await memory();
  const shell = new Shell({ fs, cwd: "/work", env: specialEnv() }).use(standardCommands()).use(safeJsCommands({ runtime }));
  const source = 'import { env, cwd } from "command"; import { readText, write } from "stdio"; await write(cwd + ":" + env["__proto__"] + ":" + await readText());';
  const result = await shell.exec(`printf 'é😀' | safejs -e ${quote(source)} | cat`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "/work:literal:é😀");
});

test("PUBLIC fs returned text preserves own proto data when decoded by the guest", async () => {
  const fs = await memory();
  await fs.writeFile("/work/data", Buffer.from(JSON.stringify(specialEnv())));
  const module = makeSafeJsFsModule(makeFsModule, fs, { cwd: "/work", signal: new AbortController().signal });
  const result = await run('import { readFile } from "fs"; const data = JSON.parse(await readFile("data", "utf8")); return [data["__proto__"], data.constructor, data.prototype];', {
    modules: { fs: module }, signal: new AbortController().signal,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.returnValue, ["literal", "ctor", "proto"]);
});

test("PUBLIC fs returned dirent/stat capabilities preserve supported predicate metadata", async () => {
  const fs = await memory();
  await fs.writeFile("/work/__proto__", Buffer.from([0, 255, 195, 169]));
  const controller = new AbortController();
  const module = makeSafeJsFsModule(makeFsModule, fs, { cwd: "/work", signal: controller.signal });
  const result = await run('import { readdir, stat } from "fs"; const entries = await readdir(".", {withFileTypes:true}); const entry = entries[0]; const info = await stat(entry.name); return [entry.name, entry.isFile(), entry.isDirectory(), info.isFile(), info.isDirectory(), info.size];', {
    modules: { fs: module }, signal: controller.signal,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.returnValue, ["__proto__", true, false, true, false, 4]);
});

test("PUBLIC shell guest env and returned text preserve own proto data without adding result capabilities", async () => {
  const fs = await memory();
  const controller = new AbortController();
  let calls = 0;
  const shell = makeSafeJsShellModule((_source, options) => {
    calls += 1;
    assert.ok(Object.hasOwn(options.env, "__proto__"));
    assert.equal(options.env.__proto__, "literal");
    return Object.fromEntries([["stdout", JSON.stringify(options.env)], ["stderr", ""], ["exitCode", 0], ["__proto__", "not an allowed result field"]]);
  }, { fs, signal: controller.signal, replayPolicy: "read-side-effect", declareHostOperation });
  const result = await run(`import { exec } from "shell"; const result = await exec("test", {env:JSON.parse(${JSON.stringify(JSON.stringify(specialEnv()))})}); return [JSON.parse(result.stdout)["__proto__"], Object.keys(result)];`, {
    modules: { shell }, signal: controller.signal,
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(result.returnValue, ["literal", ["stdout", "stderr", "exitCode"]]);
});

for (const [label, reason] of [["Error", new Error("private abort reason")], ["record", Object.freeze({ secret: "private abort reason" })], ["null", null], ["false", false]]) {
  test(`PUBLIC command preabort preserves exact ${label} reason without invoking runtime or I/O`, async () => {
    const fs = await memory();
    let effects = 0;
    const effect = () => { effects += 1; throw new Error("Forbidden pre-abort work"); };
    const watched = { ...runtime, run: (...args) => { effects += 1; return runtime.run(...args); } };
    const error = await rejected(command("return 42;", {
      fs, signal: AbortSignal.abort(reason), runtime: watched,
      stdin: { [Symbol.asyncIterator]: effect }, stdout: { write: effect }, stderr: { write: effect },
    }));
    assert.ok(Object.is(error, reason));
    assert.equal(effects, 0);
  });

  test(`PUBLIC shell preabort uses its established sanitized AbortError for ${label}`, async () => {
    let effects = 0;
    const shell = makeSafeJsShellModule(() => { effects += 1; throw new Error("Forbidden executor call"); }, {
      fs: await memory(), signal: AbortSignal.abort(reason), replayPolicy: "read-side-effect", declareHostOperation,
    });
    const error = await rejected(shell.exec("not run"));
    assert.equal(error.name, "AbortError");
    assert.equal(error.code, "ABORT_ERR");
    assert.equal(error.message, "The operation was aborted");
    assert.equal(Object.hasOwn(error, "cause"), false);
    assert.equal(error === reason, false);
    assert.equal(effects, 0);
  });

  test(`PUBLIC fs preabort uses sanitized AbortError for ${label} without backend access`, async () => {
    const fs = await memory();
    let effects = 0;
    fs.readFile = () => { effects += 1; throw new Error("Forbidden backend call"); };
    const bridge = createNodeFsBridge(fs, { signal: AbortSignal.abort(reason) });
    const error = await rejected(bridge.readFile("/work/anything", "utf8"));
    assert.equal(error.name, "AbortError");
    assert.equal(error.code, "ABORT_ERR");
    assert.equal(error.message, "The operation was aborted");
    assert.equal(Object.hasOwn(error, "cause"), false);
    assert.equal(effects, 0);
  });
}

for (const mode of ["command-fs", "command-stdin", "command-stdout", "command-console", "fs-module", "shell-module"]) {
  test(`PUBLIC cancellation with immediate host rejection: ${mode}`, { timeout: 10_000 }, context => {
    const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", import.meta.resolve("tsx"),
      fileURLToPath(new URL("./cancel.child.mjs", import.meta.url)), mode], {
      cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 8000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const observation = JSON.parse(child.stdout.trim());
    assert.equal(observation.lateRejectionObserved, true);
    assert.equal(observation.calls, 1);
    context.diagnostic(JSON.stringify(observation));
  });
}

test("PUBLIC command dataSize quota stops guest recovery and later filesystem effects", async () => {
  const fs = await memory();
  await fs.writeFile("/work/large", Buffer.alloc(32 * 1024, 120));
  let reads = 0;
  const readFile = fs.readFile.bind(fs);
  fs.readFile = (...args) => { reads += 1; return readFile(...args); };
  const result = await command('import { readFile, writeFile } from "fs"; try { await readFile("large", "utf8"); } catch (error) {} await writeFile("after", "wrong"); return "recovered";', {
    fs, limits: { dataSize: 16 * 1024 },
  });
  assert.equal(reads, 1);
  assert.equal(result.exitCode, 124, result.stderr);
  assert.equal(result.stdout.length, 0);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["large"]);
});

test("PUBLIC command invalidates retained fs/stdio/exit capabilities after completion", async () => {
  let modules;
  const watched = { ...runtime, run: (source, options) => { modules = options.modules; return run(source, options); } };
  const fs = await memory();
  await fs.writeFile("/work/data", Buffer.from("kept"));
  const result = await command('import { stat } from "fs"; const info = await stat("data"); return [info.isFile(), info.size];', { fs, runtime: watched });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), "[true,4]\n");
  await assert.rejects(modules.fs.writeFile("/work/after", "wrong"), { name: "AbortError" });
  await assert.rejects(modules.stdio.write("wrong"), { name: "AbortError" });
  assert.throws(() => modules.command.setExitCode(7), { name: "AbortError" });
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["data"]);
});

test("PUBLIC bridge actual finite payload fits a documented ample budget without resetting it", async () => {
  const fs = await memory();
  await fs.writeFile("/work/data", Buffer.from("é😀".repeat(128)));
  const controller = new AbortController();
  const budget = new Budget({ maxSteps: 10_000, dataSize: 128 * 1024 });
  const result = await run('import { readFile, stat } from "fs"; const text = await readFile("data", "utf8"); const info = await stat("data"); return [text.length, info.isFile(), info.size];', {
    modules: { fs: makeSafeJsFsModule(makeFsModule, fs, { cwd: "/work", signal: controller.signal }) },
    signal: controller.signal, budget,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.returnValue, [384, true, 768]);
});
