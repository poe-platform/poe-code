import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import readline from "node:readline";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
const namespace = "tests/integration/agent-bash-coherent-b2-preflight-20260829";
const owned = `${repository}/${namespace}`;
const work = "/private/tmp/safe-bash-b2-completion-r4-01a04d95";
const stageRoot = `${work}/staged`;
const capture = "/private/tmp/safe-bash-b2-completion-r4-01a04d95.log";
const birth = fs.statSync(capture).birthtimeMs;
const clock = performance.now();
const elapsedAtStart = Date.now() - birth;
const elapsed = () => elapsedAtStart + performance.now() - clock;
const limits = Object.freeze({ seconds: 1800, activeSeconds: 1620, os: 64, peak: 3, raw: 100663296, work: 536870912 });
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const events = [];
let osStarts = 14;
let live = 1;
let peak = 1;
let stopped = false;
let checkpointNumber = 0;
fs.mkdirSync(work, { mode: 0o700 });
process.chdir(work);
function output(value) {
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  fs.writeSync(1, bytes);
  fs.writeSync(3, bytes);
}
function read(filename, expected, maximum = 33554432) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.ok(Number.isSafeInteger(stat.size) && stat.size <= maximum);
  if (expected) {
    assert.ok(Number.isSafeInteger(expected.bytes) && expected.bytes >= 0);
    assert.match(expected.sha256, /^[a-f0-9]{64}$/);
    assert.equal(stat.size, expected.bytes);
  }
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.dev, stat.dev);
    assert.equal(opened.ino, stat.ino);
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const amount = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      assert.ok(amount > 0);
      offset += amount;
    }
    const after = fs.fstatSync(descriptor);
    assert.equal(after.size, stat.size);
    assert.equal(after.mtimeMs, stat.mtimeMs);
    if (expected) assert.equal(sha(bytes), expected.sha256, filename);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
function save(filename, value) {
  assert.ok(filename.startsWith(`${work}/`));
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + "\n");
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(filename, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  return { bytes: bytes.length, sha256: sha(bytes) };
}
function inventory(root) {
  const result = [];
  function walk(current) {
    for (const name of fs.readdirSync(current).sort()) {
      const filename = path.join(current, name);
      const stat = fs.lstatSync(filename);
      assert.ok(result.length < 16384);
      if (stat.isDirectory()) walk(filename);
      else {
        assert.ok(stat.isFile() && !stat.isSymbolicLink());
        const bytes = read(filename);
        result.push({ path: path.relative(root, filename), bytes: bytes.length, sha256: sha(bytes) });
      }
    }
  }
  walk(root);
  return Object.freeze(result.map(row => Object.freeze(row)));
}
function check(reserve = false) {
  assert.ok(elapsed() < (reserve ? limits.seconds : limits.activeSeconds) * 1000, "inclusive preparation deadline");
  assert.ok(osStarts <= limits.os && peak <= limits.peak, "known-role process cap");
  const captures = fs.statSync(capture).size + (fs.existsSync(`${work}/raw`) ? inventory(`${work}/raw`).reduce((sum, row) => sum + row.bytes, 0) : 0);
  assert.ok(captures <= limits.raw, "raw capture cap");
  const bytes = inventory(work).reduce((sum, row) => sum + row.bytes, 0) + inventory(`${owned}/completion-r4`).reduce((sum, row) => sum + row.bytes, 0) + fs.statSync(capture).size;
  assert.ok(bytes + 4194304 <= limits.work, "work and publication reserve cap");
  return Object.freeze({ elapsedSeconds: elapsed() / 1000, osStarts, peak, captureBytes: captures, chargedBytes: bytes });
}
async function subprocess(role, executable, args, options = {}) {
  check(options.reserve === true);
  assert.ok(osStarts + 1 <= limits.os);
  const index = events.length;
  fs.mkdirSync(`${work}/raw`, { recursive: true, mode: 0o700 });
  const stdoutPath = `${work}/raw/${index}-${role}.stdout`;
  const stderrPath = `${work}/raw/${index}-${role}.stderr`;
  const stdout = fs.openSync(stdoutPath, "wx", 0o600);
  let stderr;
  try { stderr = fs.openSync(stderrPath, "wx", 0o600); }
  catch (error) { fs.closeSync(stdout); throw error; }
  osStarts += 1;
  live += 1;
  peak = Math.max(peak, live);
  const child = spawn(executable, args, { cwd: options.cwd ?? repository, env: { HOME: work, TMPDIR: work, TMP: work, TEMP: work, PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", NODE_OPTIONS: "", NODE_PATH: "" }, stdio: ["pipe", stdout, stderr] });
  child.stdin.on("error", () => {});
  child.stdin.end(options.input);
  let forced;
  const timer = setInterval(() => {
    try { check(options.reserve === true); }
    catch (error) { forced = error; child.kill("SIGKILL"); }
  }, 100);
  try {
    const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
    const event = Object.freeze({ role, executable, args, ...result, stdoutPath, stderrPath });
    events.push(event);
    if (forced) throw forced;
    assert.equal(result.signal, null);
    assert.ok((options.codes ?? [0]).includes(result.code), JSON.stringify(event));
    return { ...event, stdout: read(stdoutPath).toString(), stderr: read(stderrPath).toString() };
  } finally { clearInterval(timer); live -= 1; fs.closeSync(stdout); fs.closeSync(stderr); }
}
const git = (role, args, options) => subprocess(role, "/usr/bin/git", ["-c", "gc.auto=0", "-c", "maintenance.auto=false", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], options);
async function patchFiles(files) {
  const text = "*** Begin Patch\n" + files.map(file => `*** Add File: ${namespace}/completion-r4/${file.name}\n${file.text.replace(/\n$/, "").split("\n").map(line => `+${line}`).join("\n")}\n`).join("") + "*** End Patch\n";
  await subprocess("apply-patch", "/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch", [], { input: text });
}
const inspection = JSON.parse(read("/private/tmp/safe-bash-b2-completion-r3-01a04d95/INSPECTION.json", { bytes: 5819094, sha256: "ff8ee6723c96cd073ebdc979f37c8c0337f9087a337ee94806d979f5703a1da3" }));
const review = JSON.parse(read("/private/tmp/safe-bash-b2-completion-r3-01a04d95/REVIEW.json", { bytes: 20894314, sha256: "7b34d55ce7bc786c7660a03cde793abd1b1701e3123ee087e4b9987fe2675b3e" }));
const controllerSeal = save(`${work}/CONTROLLER-PRESEAL.json`, { original: `${namespace}/completion-r4/controller.mjs`, bytes: fs.statSync(import.meta.filename).size, sha256: sha(read(import.meta.filename)), preparationOnly: true });
const context = { repository, namespace, owned, work, stageRoot, inspection, review, read, save, subprocess, events, patchFiles, git, inventory, check };
let snapshot;
async function dispatch(request) {
  if (request.action === "read") return read(request.path ?? `${owned}/completion-r3/${request.file}`).toString().slice(request.offset ?? 0, (request.offset ?? 0) + (request.length ?? 16000));
  if (request.action === "snapshot") {
    assert.equal(snapshot, undefined);
    const files = inventory(`${owned}/completion-r3`);
    const status = await git("r3-scoped-status", ["status", "--porcelain=v1", "--untracked-files=all", "--", `${namespace}/completion-r3`]);
    snapshot = { schema: "B2_R3_UNCOMMITTED_IDENTITY_SNAPSHOT", files, status: status.stdout, unchangedPartialCommit: "881ed8989062e4aaff749d35400f1e72adf5f0db", priorStop: "active deadline consumed at 1455.943289 seconds; controls never ran", initialization: "reported exit127; tool transcript only; raw artifact UNAVAILABLE", parser78: "AUTHORING_DEFECT_NOT_SOURCE_INTEGRITY_MISMATCH", captureQualification: "Current administration raw contains instruction plaintext accidentally read during bootstrap; retained locally, not published as evidence. No old capture qualification.", census: check() };
    await patchFiles([{ name: "R3-DRAFT-SNAPSHOT.json", text: JSON.stringify(snapshot, null, 2) + "\n" }]);
    return snapshot;
  }
  if (request.action === "copy") {
    assert.ok(snapshot);
    const names = request.names;
    const files = names.map(name => {
      const identity = snapshot.files.find(row => row.path === name);
      assert.ok(identity);
      return { name, text: read(`${owned}/completion-r3/${name}`, identity).toString().replaceAll("completion-r3", "completion-r4").replaceAll("runtime-r3", "runtime-r4").replaceAll("B2_RUNTIME_GO_R3", "B2_RUNTIME_GO_R4").replaceAll("B2_RUNTIME_REVIEW_R3", "B2_RUNTIME_REVIEW_R4") };
    });
    await patchFiles(files);
    return files.map(file => file.name);
  }
  if (request.action === "patch") { await subprocess("apply-patch", "/Users/kjopek/.codex/tmp/arg0/codex-arg0wITElD/apply_patch", [], { input: request.patch }); return { patched: true }; }
  if (request.action === "syntax") {
    const results = [];
    for (const row of inventory(`${owned}/completion-r4`)) {
      if (!row.path.endsWith(".mjs")) continue;
      try { new vm.SourceTextModule(read(`${owned}/completion-r4/${row.path}`, row).toString()); results.push({ path: row.path, status: "PARSE_ONLY_OK" }); }
      catch (error) { results.push({ path: row.path, status: "PARSE_ERROR", error: String(error) }); }
    }
    save(`${work}/SYNTAX-${events.length}.json`, results);
    assert.ok(results.every(row => row.status === "PARSE_ONLY_OK"));
    return results;
  }
  if (request.action === "checkpoint") {
    checkpointNumber += 1;
    const paths = inventory(`${owned}/completion-r4`).map(row => `${namespace}/completion-r4/${row.path}`);
    await git("owned-add", ["add", "--", ...paths], { reserve: true });
    await git("authored-whitespace", ["diff", "--cached", "--check", "--", ...paths], { reserve: true });
    const result = await git("atomic-owned-commit", ["commit", "--only", "-m", request.message ?? "Add executable B2 r4 completion code with pending controls", "--", ...paths], { reserve: true });
    const commit = await git("owned-commit-id", ["rev-parse", "HEAD"], { reserve: true });
    save(`${work}/CHECKPOINT-${checkpointNumber}.json`, { commit: commit.stdout.trim(), files: inventory(`${owned}/completion-r4`), census: check(true) });
    return { commit: commit.stdout.trim(), output: result.stdout, census: check(true) };
  }
  if (request.action === "invoke") {
    const filename = `${owned}/completion-r4/${request.file}`;
    const bytes = read(filename);
    new vm.SourceTextModule(bytes.toString());
    const staged = `${work}/module-${events.length}.mjs`;
    save(`${staged}.preseal.json`, { original: `${namespace}/completion-r4/${request.file}`, bytes: bytes.length, sha256: sha(bytes) });
    save(staged, bytes);
    const module = await import(pathToFileURL(staged).href);
    return module[request.export ?? "generate"](context, request.options ?? {});
  }
  if (request.action === "close") return { close: true, census: check(true), events };
  throw new Error("unknown fixed controller operation");
}
output({ ready: "R4_FILE_BASED_CONTROLLER", controllerSeal, census: check(), bootstrapKnownStartsConservative: 14 });
const input = readline.createInterface({ input: process.stdin, terminal: false });
for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
    check(request.action === "checkpoint" || request.action === "close");
    assert.ok(!stopped);
    const result = await dispatch(request);
    output({ action: request.action, result });
    if (request.action === "close") { input.close(); break; }
  } catch (error) {
    stopped = true;
    const failure = { status: "STOP", error: String(error.stack ?? error), events, elapsedSeconds: elapsed() / 1000 };
    try { save(`${work}/CONTROLLER-STOP.json`, failure); } catch {}
    output(failure);
    process.exitCode = 1;
    input.close();
    break;
  }
}
