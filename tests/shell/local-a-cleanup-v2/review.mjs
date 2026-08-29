import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const own = path.dirname(fileURLToPath(import.meta.url));
const repo = "/Users/kjopek/Workspace/safe-bash";
const started = Date.now(), deadline = started + 300000;
const output = fs.openSync(path.join(own, "owner.stdout"), "wx", 0o600);
const errors = fs.openSync(path.join(own, "owner.stderr"), "wx", 0o600);
const hash = raw => crypto.createHash("sha256").update(raw).digest("hex");
function read(filename) { const stat = fs.lstatSync(filename); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2097152); const raw = fs.readFileSync(filename); assert.equal(raw.length, stat.size); return raw; }
function record(name, value) { assert(Date.now() < deadline); const raw = Buffer.from(JSON.stringify(value, null, 2) + "\n"); assert(raw.length <= 2097152); fs.writeFileSync(path.join(own, name), raw, { flag: "wx", mode: 0o600 }); }
let failed = false;
try {
  const authOut = fs.openSync(path.join(own, "baseline.stdout"), "wx", 0o600);
  const authErr = fs.openSync(path.join(own, "baseline.stderr"), "wx", 0o600);
  let child;
  try { child = spawnSync("/usr/bin/git", ["show", "ec74e14df6bb7caf6b1be59fd44b027d7240101e:src/shell/runtime.ts"], { cwd: repo, stdio: ["ignore", authOut, authErr], timeout: 30000 }); }
  finally { fs.fsyncSync(authOut); fs.fsyncSync(authErr); fs.closeSync(authOut); fs.closeSync(authErr); }
  assert.equal(child.status, 0); assert.equal(child.signal, null); assert.equal(child.error, undefined);
  const sourceRaw = read(path.join(repo, "src/shell/runtime.ts"));
  const baseRaw = read(path.join(own, "baseline.stdout"));
  const source = sourceRaw.toString(), base = baseRaw.toString();
  const startMarker = "        if (command === \"local\" && indexedLocal) {";
  const endMarker = "        if (command === \"local\" && !locals!.has(name)) {";
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  const baseStart = base.indexOf(startMarker), baseEnd = base.indexOf(endMarker, baseStart);
  assert(start > 0 && end > start && baseStart > 0 && baseEnd > baseStart);
  assert.equal(source.slice(0, start), base.slice(0, baseStart));
  assert.equal(source.slice(end), base.slice(baseEnd));
  const branch = source.slice(start, end);
  const fragment = branch.slice(branch.indexOf("          const existingLocal"), branch.lastIndexOf("          continue;"));
  const replacements = [["let operation: ArrayOwner | undefined;", "let operation;"], ["let holding: ReturnType<ArrayOwner[\"hold\"]> | undefined;", "let holding;"], ["let shadow: IndexedBinding | undefined;", "let shadow;"], ["let primary: unknown;", "let primary;"], ["let released: Promise<void> | undefined;", "let released;"], ["(action: () => void | Promise<void>): Promise<void>", "(action)"], ["locals!", "locals"], ["shadow!", "shadow"], ["stateMonitor(state)!", "stateMonitor(state)"]];
  let executable = fragment;
  for (const [before, after] of replacements) { assert(executable.includes(before)); executable = executable.split(before).join(after); }
  record("SOURCE-SEAL.json", { sourceSha256: hash(sourceRaw), baseSha256: hash(baseRaw), branchSha256: hash(Buffer.from(branch)), helperSha256: hash(read(fileURLToPath(import.meta.url))), foreignPrefixSuffixEqual: true, replacements, fragment, productImports: 0, git: { pid: child.pid, status: child.status, signal: child.signal } });
  const execute = new vm.Script("(async function(env){const {locals,assignments,saveVariable,typedSavedVariables,requireArrays,ArrayOwner,IndexedBinding,state,name,match,textToken,stateMonitor,context,invocationScope,ArrayFailure}=env;" + executable + "})").runInNewContext({});
  async function probe(options = {}) {
    const counts = { prepare: 0, discard: 0, shadow: 0, operation: 0, holding: 0, publish: 0 };
    const reason = Object.hasOwn(options, "reason") ? options.reason : { stage: options.stage };
    const saved = { value: "outer" }, locals = new Map(), assignments = new Map();
    const typed = new WeakMap(), originalTyped = { original: true };
    if (options.existing) locals.set("ordinary", saved);
    else if (options.borrowed) assignments.set("ordinary", saved);
    if (options.typed) typed.set(saved, originalTyped);
    const fail = stage => { if (options.stage === stage) throw reason; };
    const cleanup = stage => { counts[stage]++; if (options.cleanup?.includes(stage)) throw options.cleanupReasons?.[stage] ?? { cleanup: stage }; };
    const shadow = { owner: {}, insert() { fail("insert"); }, async release() { cleanup("shadow"); }, async copy() { fail("shadow"); return shadow; } };
    const operation = { reserve() { fail("reserve"); return {}; }, async close() { cleanup("operation"); } };
    const owner = { ledger: {}, hold() { fail("hold"); return { release() { cleanup("holding"); } }; } };
    const store = { owner, async watch() { fail("watch"); return { valid: () => true, close() {} }; }, async prepareName() { fail("name"); return {}; }, get() { return options.typed ? shadow : undefined; }, publish() { fail("publish"); counts.publish++; return options.stage === "released" ? Promise.reject(reason) : Promise.resolve(); } };
    const invocationScope = Symbol("scope"), failures = [], state = { variables: { ordinary: "inner" }, readonlyVariables: new Set() };
    const environment = { locals, assignments, saveVariable: () => saved, typedSavedVariables: typed, requireArrays() { fail("store"); return store; }, ArrayOwner: { create() { fail("create"); return operation; } }, IndexedBinding: { create() { fail("shadow"); return shadow; } }, state, name: "ordinary", match: ["ordinary=new", "ordinary", "new"], async textToken() { fail("text"); return { release() {} }; }, stateMonitor: () => ({ publish(tickets, name, callback) { callback(); } }), context: { [invocationScope]: { failures } }, invocationScope, ArrayFailure: Error };
    const receiver = { signal: { throwIfAborted() { fail("signal"); } }, async prepareVariable(state, name, value) { counts.prepare++; typed.set(value, { prepared: true }); fail("prepare"); }, async discardVariable(value) { cleanup("discard"); typed.delete(value); } };
    let present = false, actual;
    try { await execute.call(receiver, environment); } catch (error) { present = true; actual = error; }
    return { counts, present, actual, reason, failures, saved, locals, assignments, typed, originalTyped, state };
  }
  const rows = [];
  async function check(id, body) { assert(Date.now() < deadline); try { await body(); rows.push({ id, pass: true }); } catch (error) { rows.push({ id, pass: false, error: String(error) }); } }
  await check("C01-success", async () => { const row = await probe(); assert(!row.present); assert.deepEqual(row.counts, { prepare: 1, discard: 0, shadow: 0, operation: 1, holding: 1, publish: 1 }); assert.equal(row.locals.get("ordinary"), row.saved); });
  await check("C02-prepare-cut", async () => { const row = await probe({ stage: "prepare", reason: undefined }); assert(row.present); assert.strictEqual(row.actual, undefined); assert.equal(row.counts.discard, 1); assert.equal(row.counts.operation, 0); });
  await check("C03-create-cut", async () => { const row = await probe({ stage: "create", reason: false }); assert(row.present); assert.strictEqual(row.actual, false); assert.equal(row.counts.discard, 1); assert.equal(row.counts.operation, 0); });
  await check("C04-hold-cut", async () => { const row = await probe({ stage: "hold", reason: 0 }); assert(row.present); assert.strictEqual(row.actual, 0); assert.equal(row.counts.discard, 1); assert.equal(row.counts.operation, 1); assert.equal(row.counts.holding, 0); });
  await check("C05-later-cuts", async () => { for (const stage of ["store", "watch", "reserve", "name", "shadow", "text", "insert", "signal", "publish"]) { const row = await probe({ stage }); assert(row.present); assert.strictEqual(row.actual, row.reason); assert.equal(row.counts.discard, 1); assert(row.counts.operation <= 1 && row.counts.holding <= 1 && row.counts.shadow <= 1); } });
  await check("C06-independent-cleanups-falsy-primary", async () => { for (const reason of [undefined, null, false, 0]) { const row = await probe({ stage: "signal", reason, cleanup: ["discard", "shadow", "operation", "holding"] }); assert(row.present); assert.strictEqual(row.actual, reason); assert.equal(row.failures.length, 4); for (const key of ["discard", "shadow", "operation", "holding"]) assert.equal(row.counts[key], 1); } });
  await check("C07-cleanup-only-first-error", async () => { const first = { close: true }; const row = await probe({ cleanup: ["operation", "holding"], cleanupReasons: { operation: first } }); assert(row.present); assert.strictEqual(row.actual, first); assert.equal(row.failures.length, 1); assert.equal(row.counts.holding, 1); });
  await check("C08-existing-new-typed-preparation", async () => { const row = await probe({ existing: true, stage: "hold" }); assert.equal(row.locals.get("ordinary"), row.saved); assert.equal(row.typed.has(row.saved), false); assert.equal(row.counts.discard, 1); });
  await check("C09-existing-typed-borrowed", async () => { const row = await probe({ existing: true, typed: true, stage: "hold" }); assert.equal(row.typed.get(row.saved), row.originalTyped); assert.equal(row.counts.prepare, 0); assert.equal(row.counts.discard, 0); });
  await check("C10-assignment-typed-borrowed", async () => { const row = await probe({ borrowed: true, typed: true, stage: "hold" }); assert.equal(row.typed.get(row.saved), row.originalTyped); assert.equal(row.assignments.get("ordinary"), row.saved); assert.equal(row.counts.prepare, 0); assert.equal(row.counts.discard, 0); });
  await check("C11-published-release-rejection", async () => { const row = await probe({ stage: "released", reason: 0 }); assert(row.present); assert.strictEqual(row.actual, 0); assert.equal(row.locals.get("ordinary"), row.saved); assert(row.typed.has(row.saved)); assert.equal(row.counts.discard, 0); assert.equal(row.counts.shadow, 0); assert.equal(row.counts.operation, 1); assert.equal(row.counts.holding, 1); });
  await check("C12-foreign-source-and-ledger-rules", async () => { assert(!branch.includes("refund")); assert(!branch.includes(".reset(")); assert(branch.includes("generation: true, version: true, epoch: true, work: 8")); assert(source.includes("if (state.readonlyVariables?.has(name) && (match[2] !== undefined || command === \"local\"))")); });
  record("RESULT.json", { groups: 12, passed: rows.filter(row => row.pass).length, rows, sourceSha256: hash(sourceRaw), sourceOnly: true, actualPrivateOwners: false, actualShellCalls: 0, Workers: 0, helperChildren: 1, gitRetired: child.status === 0 && child.signal === null, started, finished: Date.now() });
  fs.writeSync(output, JSON.stringify({ groups: 12, passed: rows.filter(row => row.pass).length }) + "\n");
  failed = rows.some(row => !row.pass);
} catch (error) { failed = true; fs.writeSync(errors, String(error?.stack ?? error) + "\n"); }
finally { for (const fd of [output, errors]) { fs.fsyncSync(fd); fs.closeSync(fd); } }
if (failed) process.exitCode = 1;
