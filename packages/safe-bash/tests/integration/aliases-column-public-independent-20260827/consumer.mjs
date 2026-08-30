import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import workerThreads from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import { families, nestedOption, specifiers } from "./contract.mjs";

const configuration = JSON.parse(readFileSync(new URL("./configuration.json", import.meta.url)));
const fixtures = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
const packageDirectory = realpathSync(new URL("./node_modules/virtual-bash", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const loaded = [];
const workers = [];
const results = [];
let intercept;
const OriginalWorker = workerThreads.Worker;
workerThreads.Worker = class extends OriginalWorker {
  constructor(filename, options) {
    const path = fileURLToPath(filename);
    assert.ok(path.startsWith(`${packageDirectory}/dist/`), `worker outside installed dist: ${path}`);
    let hash = null;
    try { hash = digest(readFileSync(path)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    super(filename, options);
    const record = { path, sha256: hash, options, ready: false, exited: false, requests: 0 };
    workers.push(record);
    this.record = record;
    this.on("message", message => { if (message?.ready === true) record.ready = true; });
    this.on("exit", code => { record.exited = true; record.exitCode = code; });
  }
  postMessage(request, ...rest) {
    this.record.requests++;
    if (intercept && request?.rows?.length) return intercept(this, request);
    return super.postMessage(request, ...rest);
  }
};
syncBuiltinESMExports();
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:")) {
      const path = fileURLToPath(url);
      assert.ok(path.startsWith(`${packageDirectory}/dist/`), `product source fallback: ${path}`);
      assert.ok(path.endsWith(".js"), `noncompiled product module: ${path}`);
    }
    const result = nextLoad(url, context);
    if (url.startsWith("file:")) {
      assert.ok(result.source !== null && result.source !== undefined);
      const hash = digest(result.source);
      assert.equal(hash, digest(readFileSync(fileURLToPath(url))));
      loaded.push({ url, sha256: hash, format: result.format, provenance: "synchronous Node load-hook source bytes" });
    }
    return result;
  },
});

const root = await import("virtual-bash");
const modules = {};
for (const family of Object.keys(families)) {
  const surfaces = [];
  for (const specifier of specifiers(configuration, family)) {
    const module = await import(specifier);
    for (const name of families[family]) assert.equal(typeof module[name], "function", `${specifier}: ${name}`);
    surfaces.push(module);
  }
  for (const module of surfaces.slice(1)) for (const name of families[family]) assert.equal(module[name], surfaces[0][name], `root/subpath identity: ${name}`);
  modules[family] = surfaces[0];
}
const aliases = modules.aliases;
const column = modules.column;
const mode = configuration.mode;
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};
const settled = promise => promise.then(value => ({ value }), error => ({ error }));
const within = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("fixture watchdog: 10000ms")), 10000); })]); }
  finally { clearTimeout(timer); }
};
async function check(id, execute) {
  try { await within(execute()); results.push({ id, status: "PASS" }); }
  catch (error) { results.push({ id, status: "FAIL", error: error.stack }); }
}
function shellWith(plugin, fs = root.createMemoryFileSystem()) {
  return new root.Shell({ fs }).use(plugin);
}
function integratedShell(fs = root.createMemoryFileSystem(), options = {}) {
  const shell = shellWith(root.agentCommands(options), fs);
  if (mode === "baseline") shell.use(aliases.grepAliasCommands()).use(column.columnCommands());
  return shell;
}
function exact(result, expected) {
  assert.equal(result.exitCode, expected.exitCode);
  assert.equal(result.stdout, expected.stdout);
  assert.equal(result.stderr, expected.stderr);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(expected.stdout));
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(expected.stderr));
}
const host = commands => ({ commands, use() { assert.fail("unexpected plugin middleware"); }, registerFileSystem() { assert.fail("unexpected filesystem registration"); } });

if (process.argv[2] === "worker-layout-control") {
  const shell = shellWith(aliases.grepAliasCommands());
  const result = await shell.exec("egrep a", { stdin: "a\n" });
  await shell.dispose();
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^egrep: regex WORKER_ERROR:/);
  assert.ok(workers.length > 0 && workers.every(worker => worker.sha256 === null && worker.exited));
  console.log(JSON.stringify({ mode, control: "missing worker rejected", result, loaded, workers }));
} else {
  await check(mode === "baseline" ? "baseline-observation-70-and-missing-root-functions" : "exact-73-defaults-no-optional-capabilities", async () => {
    const expected = [...fixtures.baselineNames, ...(mode === "candidate" ? fixtures.addedNames : [])].sort();
    assert.equal(expected.length, mode === "candidate" ? 73 : 70);
    const definitions = root.createAgentCommands();
    assert.deepEqual(definitions.map(command => command.name).sort(), expected);
    const shell = shellWith(root.agentCommands());
    try {
      await shell.exec("");
      assert.deepEqual(shell.commands.list().map(command => command.name).sort(), expected);
      for (const name of ["curl", "safejs"]) assert.equal(shell.commands.has(name), false);
      if (mode === "baseline") for (const name of Object.values(families).flat()) assert.equal(root[name], undefined);
    } finally { await shell.dispose(); }
  });
  for (const fixture of fixtures.cases) await check(`${mode === "baseline" ? "internal-composition-probe" : "public-default"}:${fixture.id}`, async () => {
    const fs = root.createMemoryFileSystem();
    for (const [path, text] of Object.entries(fixture.files ?? {})) await fs.writeFile(path, Buffer.from(text));
    const shell = integratedShell(fs);
    try {
      exact(await shell.exec(fixture.script, { stdin: fixture.stdin }), fixture);
      if (fixture.file) assert.equal(Buffer.from(await fs.readFile(fixture.file)).toString(), fixture.fileText);
    } finally { await shell.dispose(); }
  });
  await check("standalone-alias-plugin-no-registered-grep-middleware", async () => {
    const shell = shellWith(aliases.grepAliasCommands());
    const visits = [];
    shell.use(async (context, next) => { visits.push(["enter", context.command, [...context.args], context.stdinIsDefault]); const result = await next(); visits.push(["leave", context.command]); return result; });
    try {
      exact(await shell.exec("egrep 'a|b'", { stdin: "a\nb\nx\n" }), { stdout: "a\nb\n", stderr: "", exitCode: 0 });
      exact(await shell.exec("fgrep 'a.b'", { stdin: "a.b\naxb\n" }), { stdout: "a.b\n", stderr: "", exitCode: 0 });
      assert.equal(shell.commands.has("grep"), false);
      assert.deepEqual(shell.commands.list().map(command => command.name).sort(), ["egrep", "fgrep"]);
      assert.deepEqual(visits, [["enter", "egrep", ["a|b"], false], ["leave", "egrep"], ["enter", "fgrep", ["a.b"], false], ["leave", "fgrep"]]);
    } finally { await shell.dispose(); }
  });
  await check("factory-definitions-and-individual-commands", async () => {
    assert.deepEqual(aliases.createGrepAliasCommands().map(command => command.name), ["egrep", "fgrep"]);
    assert.deepEqual(column.createColumnCommands().map(command => command.name), ["column"]);
    const shell = new root.Shell({ fs: root.createMemoryFileSystem() });
    shell.register(aliases.egrepCommand()).register(aliases.fgrepCommand()).register(column.createColumnCommand());
    try { exact(await shell.exec("egrep a | fgrep a | column -t", { stdin: "a b\n" }), { stdout: "a  b\n", stderr: "", exitCode: 0 }); }
    finally { await shell.dispose(); }
  });
  for (const [family, plugin, conflicts] of [["aliases", aliases.grepAliasCommands, ["egrep", "fgrep"]], ["column", column.columnCommands, ["column"]], ...(mode === "candidate" ? [["aggregate", root.agentCommands, ["egrep", "fgrep", "column"]]] : [])]) {
    for (const conflict of conflicts) await check(`${family}-collision-preflight-and-replace:${conflict}`, async () => {
      const commands = new root.CommandRegistry([{ name: conflict, execute: () => ({ exitCode: 23 }) }, { name: "owned-sentinel", execute: () => ({ exitCode: 19 }) }]);
      const original = commands.list();
      assert.throws(() => plugin().setup(host(commands)), new RegExp(`Command already registered: ${conflict}`));
      assert.deepEqual(commands.list(), original);
      await plugin({ replace: true }).setup(host(commands));
      assert.notEqual(commands.get(conflict), original[0]);
      assert.equal(commands.get("owned-sentinel"), original[1]);
      assert.equal(commands.list().length, family === "aggregate" ? 74 : family === "aliases" ? 3 : 2);
    });
  }
  if (mode === "candidate") for (const replace of [false, true]) await check(`aggregate-top-level-replace-authoritative:${replace}`, async () => {
    const commands = new root.CommandRegistry([{ name: "column", execute: () => ({ exitCode: 23 }) }, { name: "owned-sentinel", execute: () => ({ exitCode: 19 }) }]);
    const original = commands.list();
    const options = { ...nestedOption(configuration.declaration.agentOptions.column, { replace: !replace }), replace };
    if (replace) {
      await root.agentCommands(options).setup(host(commands));
      assert.notEqual(commands.get("column"), original[0]);
      assert.equal(commands.get("owned-sentinel"), original[1]);
      assert.equal(commands.list().length, 74);
    } else {
      assert.throws(() => root.agentCommands(options).setup(host(commands)), /Command already registered: column/);
      assert.deepEqual(commands.list(), original);
    }
  });
  for (const configurationName of ["standalone", ...(mode === "candidate" ? ["aggregate-plugin", "aggregate-definitions"] : [])]) {
    for (const name of ["egrep", "fgrep"]) await check(`regex-options-propagation:${configurationName}:${name}`, async () => {
      const regex = { requestTimeoutMs: 37, startupTimeoutMs: 3000, maxWorkers: 1, maxQueuedRequests: 0, workerOldGenerationMb: 32, workerStackMb: 2 };
      const options = mode === "candidate" ? nestedOption(configuration.declaration.agentOptions.regex, regex) : {};
      const shell = configurationName === "standalone" ? shellWith(aliases.grepAliasCommands({ regex })) : configurationName === "aggregate-plugin" ? shellWith(root.agentCommands(options)) : new root.Shell({ fs: root.createMemoryFileSystem(), commands: new root.CommandRegistry(root.createAgentCommands(options)) });
      let heldWorker;
      intercept = worker => { heldWorker = worker; };
      try {
        exact(await shell.exec(`${name} a`, { stdin: "a\n" }), { stdout: "", stderr: `${name}: regex REQUEST_TIMEOUT: active request exceeded 37ms\n`, exitCode: 2 });
        assert.ok(heldWorker?.record.ready && heldWorker.record.exited);
        assert.equal(heldWorker.record.options.resourceLimits.maxOldGenerationSizeMb, 32);
        assert.equal(heldWorker.record.options.resourceLimits.stackSizeMb, 2);
      } finally { intercept = undefined; await shell.dispose(); }
    });
  }
  for (const configurationName of ["standalone", ...(mode === "candidate" ? ["aggregate-plugin", "aggregate-definitions"] : [])]) {
    await check(`column-limits-propagation:${configurationName}`, async () => {
      const options = mode === "candidate" ? nestedOption(configuration.declaration.agentOptions.column, { limits: { maxRows: 1 } }) : {};
      const shell = configurationName === "standalone" ? shellWith(column.columnCommands({ limits: { maxRows: 1 } })) : configurationName === "aggregate-plugin" ? shellWith(root.agentCommands(options)) : new root.Shell({ fs: root.createMemoryFileSystem(), commands: new root.CommandRegistry(root.createAgentCommands(options)) });
      try { exact(await shell.exec("column -t", { stdin: "a b\nc d\n" }), { stdout: "", stderr: "column: EFBIG: column rows limit exceeded\n", exitCode: 1 }); }
      finally { await shell.dispose(); }
    });
  }
  await check("column-invalid-limit-preflight-and-options-snapshot", async () => {
    const commands = new root.CommandRegistry();
    assert.throws(() => column.columnCommands({ limits: { maxRows: 0 } }).setup(host(commands)), /Invalid column limit: maxRows/);
    assert.equal(commands.list().length, 0);
    const limits = { maxRows: 1 };
    const definition = column.createColumnCommand({ limits });
    limits.maxRows = 99;
    const shell = new root.Shell({ fs: root.createMemoryFileSystem() }).register(definition);
    try { exact(await shell.exec("column -t", { stdin: "a\nb\n" }), { stdout: "", stderr: "column: EFBIG: column rows limit exceeded\n", exitCode: 1 }); }
    finally { await shell.dispose(); }
  });
  await check("alias-family-shared-worker-and-queue-limits", async () => {
    const shell = shellWith(aliases.grepAliasCommands({ regex: { maxWorkers: 1, maxQueuedRequests: 0, requestTimeoutMs: 5000 } }));
    const entered = deferred();
    const controller = new AbortController();
    const reason = new Error("release held queue fixture");
    intercept = () => { entered.resolve(); };
    const execution = settled(shell.exec("egrep a", { stdin: "a\n", signal: controller.signal }));
    try {
      await within(entered.promise);
      exact(await shell.exec("fgrep a", { stdin: "a\n" }), { stdout: "", stderr: "fgrep: regex QUEUE_EXHAUSTED: queued request count or input byte limit exceeded\n", exitCode: 2 });
      controller.abort(reason);
      assert.equal((await execution).error, reason);
      intercept = undefined;
      exact(await shell.exec("fgrep a", { stdin: "a\n" }), { stdout: "a\n", stderr: "", exitCode: 0 });
    } finally { intercept = undefined; controller.abort(reason); await shell.dispose(); await execution; }
  });
  await check("column-output-budget-is-not-silently-defaulted", async () => {
    const shell = shellWith(column.columnCommands({ limits: { maxOutputBytes: 1 } }));
    try { exact(await shell.exec("column", { stdin: "ab\n" }), { stdout: "", stderr: "column: EFBIG: column output limit exceeded\n", exitCode: 1 }); }
    finally { await shell.dispose(); }
  });
  await check("literal-child-invocation-and-pipeline-middleware", async () => {
    const shell = integratedShell();
    const entered = [];
    const completed = [];
    shell.use(async (context, next) => { entered.push(context.command); const result = await next(); completed.push(context.command); return result; });
    try {
      exact(await shell.exec("env fgrep 'a.b' | column -t", { stdin: "a.b z\naxb y\n" }), { stdout: "a.b  z\n", stderr: "", exitCode: 0 });
      assert.deepEqual(entered.sort(), ["column", "env", "fgrep"]);
      assert.deepEqual(completed.sort(), ["column", "env", "fgrep"]);
    } finally { await shell.dispose(); }
  });
  for (const name of ["egrep", "fgrep"]) await check(`actual-Shell-external-stdin-return-rejection:${name}`, async () => {
    const reason = new Error("independent external return failure");
    let returns = 0;
    const stdin = { [Symbol.asyncIterator]() { return { async next() { return { done: false, value: Buffer.from("a\n") }; }, async return() { returns++; throw reason; } }; } };
    const shell = shellWith(aliases.grepAliasCommands());
    try {
      await assert.rejects(shell.exec(`${name} -q a`, { stdin }), error => error === reason);
      assert.equal(returns, 1);
    } finally { await shell.dispose(); }
  });
  for (const name of ["egrep", "fgrep"]) for (const action of ["abort", "dispose"]) await check(`actual-Shell-active-worker-retirement:${name}:${action}`, async () => {
    const shell = mode === "candidate" ? integratedShell() : shellWith(aliases.grepAliasCommands());
    const controller = new AbortController();
    const entered = deferred();
    const reason = new Error("independent active worker cancellation");
    let heldWorker;
    intercept = worker => { heldWorker = worker; entered.resolve(); };
    const execution = settled(shell.exec(`${name} a`, { stdin: "a\n", signal: controller.signal }));
    try {
      await within(entered.promise);
      if (action === "abort") controller.abort(reason); else await shell.dispose();
      const outcome = await within(execution);
      if (action === "abort") assert.equal(outcome.error, reason); else assert.match(outcome.error?.message ?? "", /Shell is disposed/);
      assert.ok(heldWorker.record.ready && heldWorker.record.exited, "public settlement must await active worker exit");
      if (action === "abort") {
        intercept = undefined;
        exact(await shell.exec(`${name} a`, { stdin: "a\n" }), { stdout: "a\n", stderr: "", exitCode: 0 });
      }
    } finally { intercept = undefined; controller.abort(reason); await shell.dispose(); await execution; }
  });
  await check("actual-Shell-column-owned-VFS-return-gates-exec-and-dispose", async () => {
    const entered = deferred();
    const returning = deferred();
    const release = deferred();
    const opaque = deferred();
    let returns = 0;
    const memory = root.createMemoryFileSystem();
    await memory.writeFile("/held", Buffer.from("a b\n"));
    const fs = new Proxy(memory, { get(target, key) {
      if (key === "readStream") return () => ({ [Symbol.asyncIterator]() { return { next() { entered.resolve(); return opaque.promise; }, async return() { returns++; returning.resolve(); await release.promise; return { done: true }; } }; } });
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const shell = shellWith(column.columnCommands(), fs);
    let execDone = false;
    let disposeDone = false;
    const execution = settled(shell.exec("column -t /held")).then(outcome => { execDone = true; return outcome; });
    let disposal;
    try {
      await within(entered.promise);
      disposal = shell.dispose().then(() => { disposeDone = true; });
      await within(returning.promise);
      await delay(20);
      assert.equal(execDone, false);
      assert.equal(disposeDone, false);
      release.resolve();
      await within(disposal);
      assert.match((await within(execution)).error?.message ?? "", /Shell is disposed/);
      assert.equal(returns, 1);
      opaque.reject(new Error("late owned read rejection"));
      await delay(20);
    } finally { release.resolve(); opaque.resolve({ done: true }); await shell.dispose(); await execution; }
  });
  for (const name of ["egrep", "fgrep", "column"]) await check(`opaque-stdin-abort-observes-late-rejection:${name}`, async () => {
    const entered = deferred();
    const opaque = deferred();
    const controller = new AbortController();
    const reason = new Error("independent opaque input abort");
    const stdin = { [Symbol.asyncIterator]() { return { next() { entered.resolve(); return opaque.promise; } }; } };
    const shell = name === "column" ? shellWith(column.columnCommands()) : shellWith(aliases.grepAliasCommands());
    const execution = settled(shell.exec(name === "column" ? "column -t" : `${name} a`, { stdin, signal: controller.signal }));
    try {
      await within(entered.promise);
      controller.abort(reason);
      assert.equal((await within(execution)).error, reason);
      opaque.reject(new Error("late opaque source rejection"));
      await delay(20);
    } finally { controller.abort(reason); opaque.resolve({ done: true }); await shell.dispose(); await execution; }
  });
  await check("all-owned-workers-exited-and-loaded-bytes-authenticated", async () => {
    assert.ok(loaded.some(entry => entry.url.endsWith("/dist/index.js")));
    assert.ok(loaded.some(entry => entry.url.endsWith("/dist/commands/grep-aliases/index.js")));
    assert.ok(loaded.some(entry => entry.url.endsWith("/dist/commands/column/index.js")));
    assert.ok(workers.length > 0);
    for (const worker of workers) {
      assert.ok(worker.ready && worker.exited);
      assert.equal(digest(readFileSync(worker.path)), worker.sha256);
    }
  });
  const failed = results.filter(result => result.status === "FAIL");
  console.log(JSON.stringify({ mode, publicCandidateAssertions: mode === "candidate" ? "RUN" : "NOT RUN / EXPECTED RED: missing public symbols and 70 defaults", profile: mode === "baseline" ? "inspected internal installed modules with explicit composition, NOT public integration" : "declared public exports and default aggregate", results, loaded, workers, totals: { passed: results.length - failed.length, failed: failed.length } }));
  process.exitCode = failed.length ? 1 : 0;
}
