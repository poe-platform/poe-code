import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const own = path.dirname(fileURLToPath(import.meta.url)), repo = "/Users/kjopek/Workspace/safe-bash";
const started = Date.now(), deadline = started + 120000;
const out = fs.openSync(path.join(own, "owner.stdout"), "wx", 0o600);
const err = fs.openSync(path.join(own, "owner.stderr"), "wx", 0o600);
const hash = raw => crypto.createHash("sha256").update(raw).digest("hex");
function read(filename) { const stat = fs.lstatSync(filename); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2097152); const raw = fs.readFileSync(filename); assert.equal(raw.length, stat.size); return raw; }
function record(filename, value) { assert(Date.now() < deadline); const raw = Buffer.from(JSON.stringify(value, null, 2) + "\n"); assert(raw.length <= 2097152); fs.writeFileSync(path.join(own, filename), raw, { flag: "wx", mode: 0o600 }); }
try {
  const authOut = fs.openSync(path.join(own, "baseline.stdout"), "wx", 0o600), authErr = fs.openSync(path.join(own, "baseline.stderr"), "wx", 0o600);
  let child;
  try { child = spawnSync("/usr/bin/git", ["show", "faff3d1b56b841594768e476700209e1d2bca734:src/shell/runtime.ts"], { cwd: repo, stdio: ["ignore", authOut, authErr], timeout: 20000 }); }
  finally { for (const fd of [authOut, authErr]) { fs.fsyncSync(fd); fs.closeSync(fd); } }
  assert.equal(child.status, 0); assert.equal(child.signal, null); assert.equal(child.error, undefined);
  const raw = read(path.join(repo, "src/shell/runtime.ts")), baseline = read(path.join(own, "baseline.stdout"));
  const source = raw.toString(), base = baseline.toString();
  const marker = "  async prepareVariable(", next = "  async prepareArrayObservers(";
  const start = source.indexOf(marker), end = source.indexOf(next, start), oldStart = base.indexOf(marker), oldEnd = base.indexOf(next, oldStart);
  assert(start > 0 && end > start && oldStart > 0 && oldEnd > oldStart);
  assert.equal(source.slice(0, start), base.slice(0, oldStart)); assert.equal(source.slice(end), base.slice(oldEnd));
  const method = source.slice(start, end), fragment = method.slice(method.indexOf("\n") + 1, method.lastIndexOf("  }"));
  const replacements = [["stateMonitor(state)!", "stateMonitor(state)"], ["let holding: ReturnType<ArrayOwner[\"hold\"]> | undefined;", "let holding;"], ["let binding: IndexedBinding | undefined;", "let binding;"], ["let primary: unknown;", "let primary;"], ["(action: () => void | Promise<void>): Promise<void>", "(action)"]];
  let executable = fragment; for (const [before, after] of replacements) { assert(executable.includes(before)); executable = executable.split(before).join(after); }
  record("SOURCE-SEAL.json", { sourceSha256: hash(raw), baselineSha256: hash(baseline), helperSha256: hash(read(fileURLToPath(import.meta.url))), foreignPrefixSuffixEqual: true, fragment, replacements });
  const execute = new vm.Script("(async function(env){const {state,name,saved,scalarLegacy,requireArrays,stateMonitor,ArrayOwner,textToken,typedSavedVariables,ArrayFailure}=env;" + executable + "})").runInNewContext({});
  async function probe(options = {}) {
    const counts = { create: 0, hold: 0, binding: 0, close: 0, release: 0 }, failures = [], saved = { value: "outer" }, values = new Map();
    const reason = Object.hasOwn(options, "reason") ? options.reason : { primary: options.stage };
    const secondary = Object.hasOwn(options, "secondary") ? options.secondary : { secondary: true };
    const fail = stage => { if (options.stage === stage) throw reason; };
    const cleanup = stage => { counts[stage]++; if (options.cleanup?.includes(stage)) throw secondary; };
    const binding = { retain() { return binding; }, async release() { cleanup("binding"); } };
    const owner = { reserve() { return {}; }, async close() { cleanup("close"); } };
    const parent = { ledger: {}, hold() { counts.hold++; fail("hold"); return { release() { cleanup("release"); } }; } };
    const store = { owner: parent, async watch() { fail("watch"); return { valid: () => true }; }, get: () => binding };
    const environment = { state: {}, name: "ordinary", saved, scalarLegacy: false, requireArrays: () => store, stateMonitor: () => ({ session: { scope: { failures } } }), ArrayOwner: { create() { counts.create++; fail("create"); return owner; } }, textToken: async () => ({}), typedSavedVariables: { set(key, value) { fail("set"); values.set(key, value); }, delete(key) { values.delete(key); } }, ArrayFailure: Error };
    let present = false, actual;
    try { await execute.call({ signal: {} }, environment); } catch (error) { present = true; actual = error; }
    return { counts, failures, reason, secondary, present, actual, registered: values.has(saved) };
  }
  const rows = [];
  async function check(id, body) { try { assert(Date.now() < deadline); await body(); rows.push({ id, pass: true }); } catch (error) { rows.push({ id, pass: false, error: String(error) }); } }
  await check("P01-successful-transfer", async () => { const row = await probe(); assert(!row.present); assert(row.registered); assert.deepEqual(row.counts, { create: 1, hold: 1, binding: 0, close: 0, release: 1 }); });
  await check("P02-hold-falsy-failures", async () => { for (const reason of [false, 0, undefined]) { const row = await probe({ stage: "hold", reason }); assert(row.present); assert.strictEqual(row.actual, reason); assert.equal(row.counts.close, 1); assert.equal(row.counts.release, 0); assert(!row.registered); } });
  await check("P03-hold-and-close-failures", async () => { const row = await probe({ stage: "hold", reason: undefined, cleanup: ["close"], secondary: false }); assert(row.present); assert.strictEqual(row.actual, undefined); assert.equal(row.failures.length, 1); assert.strictEqual(row.failures[0], false); assert.equal(row.counts.close, 1); });
  await check("P04-body-close-hold-independent", async () => { const row = await probe({ stage: "watch", reason: 0, cleanup: ["close", "release"] }); assert.strictEqual(row.actual, 0); assert.equal(row.counts.close, 1); assert.equal(row.counts.release, 1); assert.equal(row.failures.length, 2); });
  await check("P05-binding-close-hold-independent", async () => { const row = await probe({ stage: "set", reason: false, cleanup: ["binding", "close", "release"] }); assert.strictEqual(row.actual, false); for (const key of ["binding", "close", "release"]) assert.equal(row.counts[key], 1); assert.equal(row.failures.length, 3); assert(!row.registered); });
  await check("P06-registered-hold-release-failure", async () => { const row = await probe({ cleanup: ["release"], secondary: undefined }); assert(row.present); assert.strictEqual(row.actual, undefined); assert(row.registered); assert.equal(row.counts.close, 0); assert.equal(row.counts.release, 1); });
  await check("P07-create-refusal", async () => { const row = await probe({ stage: "create", reason: 0 }); assert(row.present); assert.strictEqual(row.actual, 0); assert.equal(row.counts.hold, 0); assert.equal(row.counts.close, 0); });
  await check("P08-primary-secondary-identity", async () => { for (const reason of [undefined, null, false, 0, { marker: true }]) { const row = await probe({ stage: "set", reason, cleanup: ["binding", "close", "release"], secondary: undefined }); assert(row.present); assert.strictEqual(row.actual, reason); assert.equal(row.failures.length, 3); assert(row.failures.every(value => value === undefined)); } });
  const result = { groups: 8, passed: rows.filter(row => row.pass).length, rows, sourceSha256: hash(raw), sourceOnly: true, actualPrivateFaults: false, Shell: 0, Workers: 0, compiler: 0, child: { pid: child.pid, status: child.status, signal: child.signal }, started, finished: Date.now() };
  record("RESULT.json", result); fs.writeSync(out, JSON.stringify(result) + "\n"); if (result.passed !== 8) process.exitCode = 1;
} catch (error) { fs.writeSync(err, String(error?.stack ?? error) + "\n"); process.exitCode = 1; }
finally { for (const fd of [out, err]) { fs.fsyncSync(fd); fs.closeSync(fd); } }
