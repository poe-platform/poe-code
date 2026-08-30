import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const scope = "/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r7";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sealBytes = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "EXECUTION-SEAL.json"));
assert.equal(hash(sealBytes), process.argv[2]);
const seal = JSON.parse(sealBytes);
assert.ok(Date.now() < Date.parse(seal.deadline));
for (const row of seal.files) {
  const filename = path.join(scope, row.path); const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, row.bytes);
  assert.equal(hash(fs.readFileSync(filename)), row.sha256);
}
const { createTrace, verifyRetiredTrace } = await import("/Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r7/staged/new/trace.mjs");
const results = { controls: [], children: [], loaderAdmissions: 0, guestEntries: 0, productRuns: 0, started: new Date().toISOString() };
const root = seal.workRoot;
fs.mkdirSync(root, { mode: 0o700 });
fs.mkdirSync(path.join(root, "tmp"));
function fake({ short = false, count, writeReason, hasWriteReason = false, closeReason, hasCloseReason = false }) {
  let size = 0; let closed = 0;
  return { io: {
    openSync() { return 1; },
    fstatSync() { return { isFile: () => true, size, dev: 1, ino: 2 }; },
    writeSync(_descriptor, _bytes, _offset, length) {
      if (hasWriteReason) throw writeReason;
      const written = count === undefined ? (short ? Math.min(1, length) : length) : count;
      if (written > 0) size += written; return written;
    },
    closeSync() { closed++; if (hasCloseReason) throw closeReason; }
  }, closed: () => closed };
}
try {
  const cases = [
    { id: "T01-short-complete", options: { short: true }, success: true },
    { id: "T02-zero-write", options: { count: 0 } },
    { id: "T03-oversize-write", options: { count: 99999 } },
    { id: "T04-write-false", options: { hasWriteReason: true, writeReason: false }, exact: false },
    { id: "T05-write-undefined", options: { hasWriteReason: true, writeReason: undefined }, exact: undefined },
    { id: "T06-close-zero", options: { hasCloseReason: true, closeReason: 0 }, exact: 0 },
    { id: "T07-close-undefined", options: { hasCloseReason: true, closeReason: undefined }, exact: undefined },
    { id: "T08-primary-before-close", options: { hasWriteReason: true, writeReason: false, hasCloseReason: true, closeReason: 0 }, exact: false }
  ];
  for (const row of cases) {
    const model = fake(row.options); const write = createTrace("/owned/synthetic", model.io);
    let present = false; let reason;
    try { write({ literal: "trace" }); } catch (error) { present = true; reason = error; }
    assert.equal(model.closed(), 1); assert.equal(present, !row.success);
    if (Object.hasOwn(row, "exact")) assert.equal(reason, row.exact);
    results.controls.push({ id: row.id, pass: true, caughtPresent: present, closeCalls: model.closed(), syntheticOnly: true });
  }
  function novel(id, body) { body(); results.controls.push({ id, pass: true, independent: true }); }
  novel('N01-cumulative-cap', () => { const model = fake({}); let calls = 0; const original = model.io.writeSync; model.io.writeSync = (...args) => { calls++; return original(...args); }; const write = createTrace('/owned/cap', model.io); write({ text: 'x'.repeat(400000) }); const before = calls; assert.throws(() => write({ text: 'x'.repeat(200000) })); assert.equal(calls, before); });
  novel('N02-sticky-failure', () => { const model = fake({ hasWriteReason: true, writeReason: null }); const write = createTrace('/owned/sticky', model.io); let present = false; try { write({ x: 1 }); } catch (reason) { present = true; assert.equal(reason, null); } assert.equal(present, true); assert.throws(() => write({ x: 2 })); assert.equal(model.closed(), 1); });
  novel('N03-inode-replacement', () => { const model = fake({}); const original = model.io.fstatSync; let replaced = false; model.io.fstatSync = () => ({ ...original(), ino: replaced ? 3 : 2 }); const write = createTrace('/owned/inode', model.io); write({ x: 1 }); replaced = true; assert.throws(() => write({ x: 2 })); assert.equal(model.closed(), 2); });
  novel('N04-retirement-required', () => { assert.throws(() => verifyRetiredTrace('/never/read', { exited: true, closed: false })); assert.throws(() => verifyRetiredTrace('/never/read', { exited: false, closed: true })); });
  novel('N05-incomplete-jsonl', () => { const filename = path.join(root, 'incomplete.jsonl'); fs.writeFileSync(filename, '{}', { flag: 'wx' }); assert.throws(() => verifyRetiredTrace(filename, { exited: true, closed: true })); });
  novel('N06-trace-tamper', () => { const filename = path.join(root, 'tamper.jsonl'); fs.writeFileSync(filename, '{"literal":1}\n', { flag: 'wx' }); const first = verifyRetiredTrace(filename, { exited: true, closed: true }); fs.writeFileSync(filename, '{"literal":2}\n'); const second = verifyRetiredTrace(filename, { exited: true, closed: true }); assert.notEqual(first.sha256, second.sha256); assert.equal(second.records[0].literal, 2); });

  for (const fixture of seal.fixtures) {
    assert.ok(Date.now() < Date.parse(seal.deadline));
    const directory = path.join(root, fixture.id); fs.mkdirSync(directory);
    const members = [];
    for (const row of fixture.files) {
      const absolute = path.join(directory, row.path); const bytes = Buffer.from(row.source);
      fs.writeFileSync(absolute, bytes, { flag: "wx", mode: 0o600 });
      members.push({ absolute, path: row.path, bytes: bytes.length, sha256: hash(bytes) });
    }
    const trace = path.join(directory, "trace.jsonl");
    const binding = Buffer.from(JSON.stringify({ packageRoot: directory, members, trace }));
    const bindingPath = path.join(directory, "binding.json"); fs.writeFileSync(bindingPath, binding, { flag: "wx", mode: 0o600 });
    const stdoutPath = path.join(directory, "stdout.raw"); const stderrPath = path.join(directory, "stderr.raw");
    const stdout = fs.openSync(stdoutPath, "wx", 0o600); const stderr = fs.openSync(stderrPath, "wx", 0o600);
    const args = ["--experimental-permission", `--allow-fs-read=${root}`, `--allow-fs-read=${scope}/staged`, `--allow-fs-read=${process.execPath}`, `--allow-fs-write=${directory}`, `--allow-fs-write=${root}/tmp`, `--allow-fs-write=${trace}`, "--allow-worker", "--loader", pathToFileURL(path.join(scope, "staged/new/loader.mjs")).href, path.join(directory, "entry.mjs")];
    const record = { id: fixture.id, args, exitPresent: false, closePresent: false, signals: [], started: new Date().toISOString() };
    results.children.push(record);
    let child;
    try {
      child = spawn(process.execPath, args, { cwd: directory, env: { PATH: path.dirname(process.execPath), HOME: root, TMPDIR: path.join(root, "tmp"), TMP: path.join(root, "tmp"), TEMP: path.join(root, "tmp"), NODE_OPTIONS: "", NODE_PATH: "", PUBLIC_BINDING: bindingPath, PUBLIC_BINDING_BYTES: String(binding.length), PUBLIC_BINDING_SHA256: hash(binding) }, stdio: ["ignore", stdout, stderr] });
      record.pid = child.pid; results.loaderAdmissions++;
      const timer = setTimeout(() => { record.signals.push("SIGKILL"); child.kill("SIGKILL"); }, 15000);
      await new Promise(resolve => {
        child.on("error", error => { record.error = { message: error.message, code: error.code }; });
        child.on("exit", (code, signal) => { record.exitPresent = true; record.exitCode = code; record.exitSignal = signal; });
        child.on("close", (code, signal) => { record.closePresent = true; record.closeCode = code; record.closeSignal = signal; clearTimeout(timer); resolve(); });
      });
    } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
    record.closedAt = new Date().toISOString();
    assert.equal(record.exitPresent, true); assert.equal(record.closePresent, true); assert.equal(record.exitCode, 0); assert.equal(record.closeCode, 0); assert.equal(record.exitSignal, null); assert.equal(record.signals.length, 0);
    for (const filename of [stdoutPath, stderrPath]) assert.ok(fs.statSync(filename).size <= 65536);
    const output = fs.readFileSync(stdoutPath); const errors = fs.readFileSync(stderrPath);
    assert.equal(output.toString(), fixture.stdout);
    record.stdout = { bytes: output.length, sha256: hash(output) }; record.stderr = { bytes: errors.length, sha256: hash(errors) };
    record.trace = verifyRetiredTrace(trace, { exited: true, closed: true });
    assert.equal(record.trace.records.length, fixture.files.length);
    for (const member of members) assert.ok(record.trace.records.some(row => row.kind === "authenticated-source-prepared" && row.member === member.path && row.sha256 === member.sha256));
    record.expectedLiteralObserved = true;
  }
  results.status = "PASS";
} catch (error) {
  results.status = "STOP"; results.errorPresent = true; results.error = { message: String(error?.message ?? error), stack: String(error?.stack ?? "") }; process.exitCode = 1;
} finally {
  results.ended = new Date().toISOString();
  fs.writeFileSync(path.join(root, "RESULT.json"), JSON.stringify(results, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: results.status, controls: results.controls.length, children: results.children.length, loaderAdmissions: results.loaderAdmissions }));
}
