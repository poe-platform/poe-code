import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { observe } from "./observer.mjs";

const root = await import("virtual-bash"), leaf = await import("virtual-bash/commands/expr");
const binding = JSON.parse(readFileSync(new URL("./PRE-WIRING.json", import.meta.url)));
const results = [];
async function check(name, execute) { const start = observe.begin(); await execute(); const metrics = await observe.end(start); results.push({ name, metrics }); }
function invocation(definition, args, overrides = {}) {
  const output = [], errors = [], cleanups = [], controller = new AbortController();
  const context = { command: "expr", args, cwd: "/", env: { LC_ALL: "C" }, fs: root.createMemoryFileSystem(), signal: controller.signal,
    stdin: { [Symbol.asyncIterator]() { assert.fail("argv-only expr acquired stdin"); } },
    stdout: { async write(bytes) { output.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { errors.push(new Uint8Array(bytes)); } }, registerCleanup(cleanup) { cleanups.push(cleanup); }, ...overrides };
  const execution = Promise.resolve().then(() => definition.execute(context)); void execution.catch(() => {});
  return { controller, cleanups, context, execution, result: async () => ({ ...await execution, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() }), close: async () => { await Promise.all(cleanups.flatMap(cleanup => [cleanup(), cleanup()])); } };
}
async function direct(definition, args, overrides) { const current = invocation(definition, args, overrides); try { return await current.result(); } finally { await current.close(); } }
async function shellRun(options, source) { const shell = new root.Shell({ fs: root.createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(root.agentCommands(options)); try { const result = await shell.exec(source); return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }; } finally { await shell.dispose(); } }
const matched = { exitCode: 0, stdout: "1\n", stderr: "" };
try {
  await check("root/subpath API and literal76 inventory", async () => {
    assert.deepEqual(Object.keys(leaf).sort(), ["createExprCommand", "createExprCommands", "exprCommands"]);
    for (const name of Object.keys(leaf)) assert.equal(root[name], leaf[name]);
    assert.deepEqual(root.createAgentCommands().map(command => command.name).sort(), [...binding.names76].sort());
    assert.equal(binding.names76.length, 76);
    const shell = new root.Shell({ fs: root.createMemoryFileSystem() }).use(root.agentCommands());
    try { await shell.exec(":"); assert.deepEqual(shell.commands.list().map(command => command.name).sort(), [...binding.names76].sort()); for (const name of ["getopts", "curl", "safejs"]) assert.equal(shell.commands.has(name), false); } finally { await shell.dispose(); }
  });
  await check("VFS pipeline, statuses and bounded emergency", async () => {
    assert.deepEqual(await shellRun({}, "expr 20 + 22 > /answer; cat /answer"), { exitCode: 0, stdout: "42\n", stderr: "" });
    assert.deepEqual(await direct(root.createExprCommand(), ["0"]), { exitCode: 1, stdout: "0\n", stderr: "" });
    assert.deepEqual(await direct(root.createExprCommand(), ["+", ""]), { exitCode: 1, stdout: "\n", stderr: "" });
    assert.deepEqual(await direct(root.createExprCommand({ limits: { maxOutputBytes: 1 } }), ["7"]), { exitCode: 3, stdout: "", stderr: "expr: output bytes limit exceeded\n" });
  });
  await check("unchanged BRE match, capture and restricted guard", async () => {
    assert.deepEqual(await direct(root.createExprCommand(), ["abc", ":", "a"]), matched);
    assert.deepEqual(await direct(leaf.createExprCommand(), ["abc", ":", "\\(a\\)"]), { exitCode: 0, stdout: "a\n", stderr: "" });
    const refused = await direct(root.createExprCommand(), ["aaa", ":", "\\(a*\\)*\\1"]); assert.equal(refused.exitCode, 2); assert.equal(refused.stdout, ""); assert.match(refused.stderr, /^expr: [^\n]+\n$/u);
  });
  await check("inactive syntax and collation refusal admit no workers", async () => {
    const start = observe.records.length;
    assert.deepEqual(await direct(root.createExprCommand(), ["yes", "|", "match", "a", "["]), { exitCode: 0, stdout: "yes\n", stderr: "" });
    const refused = await direct(root.createExprCommand(), ["a", "=", "a"], { env: { LC_ALL: "en_US.UTF-8" } }); assert.equal(refused.exitCode, 2); assert.equal(refused.stdout, ""); assert.match(refused.stderr, /^expr:/u);
    assert.equal(observe.records.length, start);
  });
  for (const configured of [false, true]) await check(`global regex authority; configured=${configured}`, async () => {
    const start = observe.records.length;
    const options = { expr: { regex: { maxWorkers: 0, workerOldGenerationMb: 64 }, replace: true }, ...(configured ? { regex: { workerOldGenerationMb: 48, workerStackMb: 3, maxWorkers: 1 } } : {}) };
    assert.deepEqual(await shellRun(options, "expr abc : a"), matched);
    const record = observe.records[start]; assert.equal(observe.records.length, start + 1);
    assert.equal(record.resourceLimits.maxOldGenerationSizeMb, configured ? 48 : 128); assert.equal(record.resourceLimits.stackSizeMb, configured ? 3 : 4);
  });
  await check("direct regex and limits stay separate", async () => {
    assert.throws(() => root.createAgentCommands({ regex: { maxWorkers: 0 }, expr: { regex: { maxWorkers: 1 } } }), /regex maxWorkers/u);
    assert.throws(() => leaf.createExprCommand({ regex: { maxWorkers: 0 } }), /regex maxWorkers/u);
    const start = observe.records.length;
    assert.deepEqual(await direct(leaf.createExprCommand({ regex: { workerOldGenerationMb: 64, workerStackMb: 3 } }), ["abc", ":", "a"]), matched);
    assert.equal(observe.records[start].resourceLimits.maxOldGenerationSizeMb, 64);
    const limit = await shellRun({ expr: { limits: { maxNumericDigits: 1 } } }, "expr 22 + 1"); assert.equal(limit.exitCode, 3); assert.match(limit.stderr, /^expr:/u);
  });
  await check("caller/sink/registration exact reasons without extra effects", async () => {
    const start = observe.records.length, sentinel = new Error("author sink sentinel"), caller = new AbortController(); caller.abort(sentinel);
    await assert.rejects(direct(root.createExprCommand(), ["7"], { signal: caller.signal }), error => error === sentinel);
    await assert.rejects(direct(root.createExprCommand(), ["7"], { stdout: { async write() { throw sentinel; } }, stderr: { async write() { assert.fail("unexpected diagnostic"); } } }), error => error === sentinel);
    await assert.rejects(direct(root.createExprCommand(), ["abc", ":", "a"], { registerCleanup() { throw sentinel; } }), error => error === sentinel);
    assert.equal(observe.records.length, start);
  });
  await check("qualified silent-ready startup at actual worker constructor", async () => {
    const start = observe.records.length; observe.setMode("silent-ready");
    try {
      const result = await shellRun({ regex: { startupTimeoutMs: 50, requestTimeoutMs: 1000, maxWorkers: 1 } }, "expr abc : a");
      observe.mark("startup-public-settlement"); assert.equal(result.exitCode, 3); assert.equal(result.stdout, ""); assert.match(result.stderr, /^expr: regex STARTUP_TIMEOUT:/u);
      const record = observe.records[start]; assert.equal(record.online, true); assert.equal(record.ready, 0); assert.equal(record.requests, 0); assert.equal(record.closed, true); assert.equal(record.terminations, 1);
    } finally { observe.setMode("ordinary"); }
  });
  await check("paired unmodified worker after silent-ready control", async () => { assert.deepEqual(await shellRun({}, "expr abc : a"), matched); });
  await check("admitted cancellation and live sibling with held genuine replies", async () => {
    const definition = root.createExprCommand({ regex: { maxWorkers: 2 } }), start = observe.records.length;
    observe.setMode("hold-real-replies");
    const first = invocation(definition, ["abc", ":", "a"]), sibling = invocation(definition, ["abc", ":", "a"]);
    let siblingSettled = false; void sibling.execution.finally(() => { siblingSettled = true; }).catch(() => {});
    try {
      await observe.wait(() => observe.records.length === start + 2 && observe.records.slice(start).every(record => record.requests === 1 && record.held.length === 1));
      assert.equal(siblingSettled, false); const reason = Object.assign(new Error("author admitted cancellation"), { code: "EACCES" }); first.controller.abort(reason);
      await assert.rejects(first.execution, error => error === reason); observe.mark("direct-first-settlement");
      assert.equal(observe.records[start].closed, true); assert.equal(observe.records[start + 1].closed, false); assert.equal(sibling.controller.signal.aborted, false); assert.equal(siblingSettled, false);
      const closing = first.cleanups[0](); assert.equal(first.cleanups[0](), closing); await closing;
      observe.records[start + 1].worker.release(); assert.deepEqual(await sibling.result(), matched); observe.mark("direct-sibling-settlement");
    } finally { observe.setMode("ordinary"); first.controller.abort(new Error("author cleanup")); sibling.controller.abort(new Error("author cleanup")); await Promise.all([first.close(), sibling.close()]); }
  });
  await check("real Shell caller abort and dispose await owned retirement", async () => {
    const start = observe.records.length, controller = new AbortController(), reason = Object.assign(new Error("author shell cancellation"), { code: "EACCES" });
    const shell = new root.Shell({ fs: root.createMemoryFileSystem() }).use(root.agentCommands()); observe.setMode("hold-real-replies");
    const execution = shell.exec("expr abc : a", { signal: controller.signal }); void execution.catch(() => {});
    try {
      await observe.wait(() => observe.records.length === start + 1 && observe.records[start].held.length === 1);
      controller.abort(reason);
      const disposal = shell.dispose().then(() => { observe.mark("shell-dispose-settlement"); assert.equal(observe.records[start].closed, true); });
      await assert.rejects(execution, error => error === reason); observe.mark("shell-exec-settlement"); assert.equal(observe.records[start].closed, true); await disposal;
    } finally { observe.setMode("ordinary"); controller.abort(reason); await shell.dispose(); }
  });
  console.log(JSON.stringify({ authorPublicCases: results, observer: observe.serializable(), root: import.meta.resolve("virtual-bash"), subpath: import.meta.resolve("virtual-bash/commands/expr"), scope: "author cases; independent26 remains separate" }));
} finally { observe.restore(); }
