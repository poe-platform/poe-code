import assert from "node:assert/strict";
import workerThreads from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";

const NativeWorker = workerThreads.Worker;
const NativeRegExp = globalThis.RegExp;
const workers = [];
const hostPatterns = [];
class ObservedWorker extends NativeWorker {
  exited = false;
  terminationCalls = 0;
  termination = undefined;
  constructor(...args) {
    super(...args);
    workers.push(this);
    this.once("exit", () => { this.exited = true; });
  }
  terminate() { this.terminationCalls++; return this.termination = super.terminate(); }
}
workerThreads.Worker = ObservedWorker;
syncBuiltinESMExports();
globalThis.RegExp = new Proxy(NativeRegExp, {
  construct(target, args) {
    if (String(args[0]).includes("alpha")) hostPatterns.push(String(args[0]));
    return Reflect.construct(target, args);
  },
});
const api = await import(process.argv[2] ?? "virtual-bash");
const mode = process.argv[3] ?? "controls";
const evidence = { node: process.version, mode, checks: [], hostPatterns, workers: [] };
const state = () => workers.map(worker => ({ exited: worker.exited, threadId: worker.threadId, terminationCalls: worker.terminationCalls, listeners: Object.fromEntries(["message", "messageerror", "error", "exit"].map(event => [event, worker.listenerCount(event)])) }));
function check(name, operation) {
  try { operation(); evidence.checks.push({ name, pass: true }); }
  catch (error) { evidence.checks.push({ name, pass: false, error: error.stack }); }
}
async function settled() {
  let timer;
  try {
    await Promise.race([
      Promise.all(workers.map(worker => worker.termination ?? (worker.exited ? Promise.resolve() : new Promise(resolve => worker.once("exit", resolve))))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("exact worker retirement exceeded 3s")), 3000); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function fixture(files) {
  const fs = new api.MemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const slash = name.lastIndexOf("/");
    if (slash >= 0) await fs.mkdir(`/work/${name.slice(0, slash)}`, { recursive: true });
    await fs.writeFile(`/work/${name}`, Buffer.from(contents));
  }
  return fs;
}
async function run(name, command, expected, files = {}, stdin) {
  const fs = await fixture(files);
  const before = workers.length;
  const shell = new api.Shell({ fs, cwd: "/work" }).use(api.agentCommands());
  check(`${name}: registration`, () => assert.equal(workers.length, before));
  try {
    const result = await shell.exec(command, stdin === undefined ? {} : { stdin });
    check(`${name}: triple`, () => assert.deepEqual({ code: result.exitCode, stdout: result.stdout, stderr: result.stderr }, expected));
    check(`${name}: awaited cleanup`, () => assert.equal(workers.filter(worker => !worker.exited).length, 0));
  } finally { await shell.dispose(); }
  await settled();
}
try {
  if (mode === "lifecycle") {
    for (const command of ["grep -E '^a' | head -n 1", "rg '^a' | head -n 1"]) {
      const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
      const result = await shell.exec(command, { stdin: "ab\n".repeat(200) });
      check(`${command}: triple`, () => assert.deepEqual({ code: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { code: 0, stdout: "ab\n", stderr: "" }));
      check(`${command}: exec exact cleanup`, () => assert.equal(workers.filter(worker => !worker.exited).length, 0));
      await shell.dispose();
      check(`${command}: dispose exact cleanup`, () => assert.equal(workers.filter(worker => !worker.exited).length, 0));
      await settled();
    }
  } else {
    await run("grep", "grep -E '^a'", { code: 0, stdout: "ab\n", stderr: "" }, {}, "ab\nz\n");
    await run("rg", "rg '^a'", { code: 0, stdout: "ab\n", stderr: "" }, {}, "ab\nz\n");
    const files = { "alpha.ts": "hit\n", "alpha.js": "hit\n", "ALPHA.TS": "hit\n", "sub/alpha.ts": "hit\n", "sub/beta.md": "miss\n" };
    await run("positive", "rg --files -g 'alpha.ts'", { code: 0, stdout: "alpha.ts\nsub/alpha.ts\n", stderr: "" }, files);
    await run("negative", "rg --files -g 'alpha.*' -g '!*.js'", { code: 0, stdout: "alpha.ts\nsub/alpha.ts\n", stderr: "" }, files);
    await run("insensitive", "rg --files --iglob 'alpha.ts'", { code: 0, stdout: "ALPHA.TS\nalpha.ts\nsub/alpha.ts\n", stderr: "" }, files);
    await run("braces", "rg --files -g 'alpha.{ts,js}'", { code: 0, stdout: "alpha.js\nalpha.ts\nsub/alpha.ts\n", stderr: "" }, files);
    await run("directory", "rg --files -g '!sub/'", { code: 0, stdout: "ALPHA.TS\nalpha.js\nalpha.ts\n", stderr: "" }, files);
    await run("ignore", "rg --files", { code: 0, stdout: "ALPHA.TS\nalpha.js\nsub/alpha.ts\nsub/beta.md\n", stderr: "" }, { ...files, ".ignore": "alpha.ts\n", "sub/.ignore": "!alpha.ts\n" });
    await run("override", "rg --files -g 'alpha.ts'", { code: 0, stdout: "alpha.ts\nsub/alpha.ts\n", stderr: "" }, { ...files, ".ignore": "alpha.ts\n" });
    check("host glob containment", () => assert.deepEqual(hostPatterns, []));
    const shell = new api.Shell({ fs: await fixture(files), cwd: "/work" }).use(api.agentCommands());
    try {
      const malformed = await shell.exec("rg -g '[z-a]' -f missing");
      check("malformed glob before pattern-file I/O", () => { assert.equal(malformed.exitCode, 2); assert.match(malformed.stderr, /invalid glob/u); assert.doesNotMatch(malformed.stderr, /ENOENT|no such/u); });
      check("malformed glob cleanup", () => assert.equal(workers.filter(worker => !worker.exited).length, 0));
      const controller = new AbortController();
      const reason = new Error("preaborted public invocation");
      controller.abort(reason);
      const before = workers.length;
      try { await shell.exec("rg alpha", { stdin: "alpha\n", signal: controller.signal }); }
      catch (error) { check("preabort identity", () => assert.equal(error, reason)); }
      check("preabort no Worker", () => assert.equal(workers.length, before));
      const concurrent = await Promise.all([shell.exec("printf 'ab\\nz\\n' | grep -E '^a' | cat"), shell.exec("printf 'ab\\nz\\n' | rg '^a' | cat")]);
      check("concurrent live public pipelines", () => assert.deepEqual(concurrent.map(result => [result.exitCode, result.stdout, result.stderr]), [[0, "ab\n", ""], [0, "ab\n", ""]]));
      check("concurrent awaited cleanup", () => assert.equal(workers.filter(worker => !worker.exited).length, 0));
    } finally { await shell.dispose(); }
  }
  await settled();
  check("final exact cleanup", () => {
    for (const worker of workers) {
      assert.equal(worker.threadId, -1);
      assert.equal(worker.terminationCalls, 1);
      for (const event of ["message", "messageerror", "error", "exit"]) assert.equal(worker.listenerCount(event), 0);
    }
  });
} catch (error) {
  evidence.checks.push({ name: "child execution", pass: false, error: error.stack });
} finally {
  evidence.workers = state();
  const live = workers.filter(worker => !worker.exited);
  evidence.safetyTerminations = live.length;
  await Promise.allSettled(live.map(worker => worker.termination ?? worker.terminate()));
  globalThis.RegExp = NativeRegExp;
  console.log(JSON.stringify(evidence));
  process.exitCode = evidence.checks.some(check => !check.pass) || live.length ? 1 : 0;
}
