import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const admission = JSON.parse(readFileSync(process.env.C06_ADMISSION, "utf8"));
const api = await import(pathToFileURL(admission.publicEntry).href);
const id = process.argv[2], specification = JSON.parse(readFileSync(admission.preseal)).subcontrols.find(row => row.id === id);
assert(specification);
const events = [], observation = { id, layout: admission.layout, lookupCalls: [], outerCleanupCalls: 0, afterEntered: false };
function record(event, fields = {}) { const entry = { event, ...fields }; events.push(entry); process.stdout.write(JSON.stringify({ kind: "event", id, ...entry }) + "\n"); }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const lookupEntered = deferred(), lookupRelease = deferred(), lookupDone = deferred(), cleanupEntered = deferred(), cleanupRelease = deferred();
const rootController = new AbortController(), localController = new AbortController();
const memory = new api.MemoryFileSystem();
await memory.mkdir("/c"); await memory.mkdir("/a");
let armed = false, lookupDrained = false, cleanupPromise, execSettled = false;
const fs = new Proxy(memory, { get(target, property) {
  if (property === "stat") return async (...args) => {
    if (!armed) return target.stat(...args);
    armed = false;
    observation.lookupCalls.push({ path: args[0], signalInitiallyAborted: args[1]?.signal?.aborted });
    record("real-popd-stat-enter", { path: args[0] }); lookupEntered.resolve();
    try { await lookupRelease.promise; record("lookup-late-rejection", { reason: false }); throw false; }
    finally { lookupDrained = true; lookupDone.resolve(); record("lookup-owned-drained"); }
  };
  const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
} });
const shell = new api.Shell({ fs, cwd: "/c", env: { PWD: "/c", OLDPWD: "/old" } });
function outerCleanup() {
  cleanupPromise ??= (async () => { observation.outerCleanupCalls++; record("outer-cleanup-enter"); cleanupEntered.resolve(); await lookupDone.promise; await cleanupRelease.promise; record("outer-cleanup-drained"); })();
  return cleanupPromise;
}
async function observe(context) {
  let text = "", bytes = 0;
  const result = await context.invoke("dirs", ["-l", "-p"], { stdout: { async write(chunk) { bytes += chunk.byteLength; if (bytes > 4096) throw Error("host observation capture exceeds4096"); text += new TextDecoder().decode(chunk); } } });
  return { text, status: result.exitCode };
}
shell.use((context, next) => {
  if (context.command === "popd") { context.registerCleanup(() => lookupDone.promise); record("lookup-cleanup-registered-before-acquisition"); }
  return next();
});
shell.register({ name: "__c06", async execute(context) {
  context.registerCleanup(outerCleanup); record("outer-cleanup-registered");
  observation.parentBefore = await observe(context);
  armed = true;
  const pending = context.invoke("popd", [], { signal: localController.signal });
  const outcome = pending.then(value => ({ kind: "return", value }), reason => ({ kind: "throw", reason }));
  await lookupEntered.promise;
  observation.siblingDuring = await observe(context); record("sibling-during-pause", observation.siblingDuring);
  localController.abort(false); record("local-abort", { reason: false }); lookupRelease.resolve();
  const selected = await outcome; observation.childOutcome = selected; record("child-settled", selected);
  observation.parentAfterChild = await observe(context); record("parent-after-child", observation.parentAfterChild);
  record("live-outer-explicit-rethrow", { reason: selected.reason }); throw selected.reason;
} });
shell.register({ name: "__after", async execute(context) { observation.afterEntered = true; observation.afterStatus = context.args[0]; observation.afterFull = await observe(context); record("after-mapped-command", { status: observation.afterStatus, ...observation.afterFull }); return { exitCode: Number(context.args[0]) }; } });
const script = "pushd -n /a\n__c06\n__after \"$?\"";
const pendingExec = shell.exec(script, { signal: rootController.signal }).then(value => { execSettled = true; return { kind: "return", value }; }, reason => { execSettled = true; return { kind: "throw", reason, exactSharedFalse: Object.is(reason, false) }; });
try {
  await cleanupEntered.promise;
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  observation.settledBeforeCleanupRelease = execSettled;
  if (id === "C06-R") { rootController.abort(false); record("actual-root-abort", { reason: false }); await new Promise(resolve => setImmediate(resolve)); observation.settledAfterRootBeforeCleanup = execSettled; }
  cleanupRelease.resolve(); observation.exec = await pendingExec;
} finally {
  lookupRelease.resolve(); cleanupRelease.resolve(); await pendingExec; await outerCleanup(); await shell.dispose();
  observation.lookupNaturallyDrained = lookupDrained; observation.rootAborted = rootController.signal.aborted; observation.disposed = true; observation.events = events;
}
process.stdout.write(JSON.stringify({ kind: "observation", ...observation }) + "\n");
try {
  assert.deepEqual(observation.lookupCalls, [{ path: "/a", signalInitiallyAborted: false }]);
  assert.equal(observation.outerCleanupCalls, 1); assert(observation.lookupNaturallyDrained && observation.disposed);
  assert.equal(observation.settledBeforeCleanupRelease, false);
  assert.deepEqual(observation.childOutcome, { kind: "throw", reason: false });
  for (const field of ["parentBefore", "siblingDuring", "parentAfterChild"]) assert.deepEqual(observation[field], { text: "/c\n/a\n", status: 0 });
  assert.equal(observation.rootAborted, specification.expect.rootAborted);
  assert.equal(observation.exec.kind, specification.expect.execKind);
  if (id === "C06-M") {
    assert.equal(observation.exec.value.exitCode, specification.expect.exitCode);
    assert.equal(observation.exec.value.stdout, specification.expect.stdout); assert.equal(observation.exec.value.stderr, specification.expect.stderr);
    assert.equal(observation.afterStatus, "1"); assert.deepEqual(observation.afterFull, { text: "/c\n/a\n", status: 0 });
  } else { assert.equal(observation.exec.reason, false); assert(observation.exec.exactSharedFalse); assert.equal(observation.afterEntered, false); assert.equal(observation.settledAfterRootBeforeCleanup, false); }
  const position = event => events.findIndex(entry => entry.event === event);
  assert(position("lookup-cleanup-registered-before-acquisition") < position("real-popd-stat-enter"));
  assert(position("child-settled") < position("live-outer-explicit-rethrow"));
  assert(position("live-outer-explicit-rethrow") < position("outer-cleanup-enter"));
  process.stdout.write(JSON.stringify({ kind: "pass", id, layout: admission.layout, qualification: "public root/mapped-status contrast, not private escaping-control/local selection witness" }) + "\n");
} catch (error) { process.stdout.write(JSON.stringify({ kind: "assertion-failure", id, layout: admission.layout, error: { name: error.name, message: error.message, stack: error.stack, actual: error.actual, expected: error.expected } }) + "\n"); process.exitCode = 1; }
