import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

const version = "b2-preparation-data-controller-r2.1";
const repository = "/Users/kjopek/Workspace/safe-bash";
const namespace = "tests/integration/agent-bash-coherent-b2-preflight-20260829";
const work = "/private/tmp/safe-bash-b2-preparation-r2-01a04d95";
const author = "4a0268f2561d3b2aabf7511656baad968ee64986";
const independent = "be7d4b9827ba4350f1fcbb34ef85a43705d1487f";
const stage = "cdbf1813da3f2382a7c4e36e16dd67b8f889074f";
const curie = "bd0f227d081829512bafc2936f0b33632e02890b";
const producer = "d8524695c472cdea1e506bc234f426b4e6829cce";
const owner = "8ab0b2875c695c7cf6fbe90080cd083f69ef7146";
const base = "tests/integration/agent-bash-coherent-author-20260829/";
const n14 = "tests/compatibility/bash-strict-extension-author-20260829/n14-v4/";
const hash = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
const gitHash = buffer => crypto.createHash("sha1").update(Buffer.from(`blob ${buffer.length}\0`)).update(buffer).digest("hex");
const localStarts = [];
const started = performance.now();
let captureBytes = 0;

function admit(file, ceiling, expected) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.size > ceiling) throw new Error(`regular bounded file required: ${file}`);
  const descriptor = fs.openSync(file, "r");
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error("descriptor identity changed");
    const buffer = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (count <= 0) throw new Error("short read");
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error("read identity changed");
    if (expected && (expected.bytes !== buffer.length || expected.sha256 !== hash(buffer))) throw new Error(`seal mismatch: ${file}`);
    return buffer;
  } finally { fs.closeSync(descriptor); }
}

function gitBatch(requests, label) {
  const stdoutPath = path.join(work, `${label}.stdout.raw`);
  const stderrPath = path.join(work, `${label}.stderr.raw`);
  const stdout = fs.openSync(stdoutPath, "wx");
  let stderr;
  try {
    stderr = fs.openSync(stderrPath, "wx");
    const args = ["-c", "gc.auto=0", "-c", "maintenance.auto=false", "-C", repository, "cat-file", "--batch"];
    const result = spawnSync("/usr/bin/git", args, { input: requests.map(row => row.spec).join("\n") + "\n", stdio: ["pipe", stdout, stderr], timeout: 20000, env: { PATH: "/usr/bin:/bin", HOME: work, TMPDIR: work, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" }, cwd: work });
    localStarts.push(Object.freeze({ role: label, executable: "/usr/bin/git", args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null }));
    if (result.error || result.status !== 0 || result.signal) throw new Error(`${label}: known reader did not retire successfully`);
  } finally {
    fs.closeSync(stdout);
    if (stderr !== undefined) fs.closeSync(stderr);
  }
  const output = admit(stdoutPath, 24 * 1024 * 1024);
  captureBytes += output.length + fs.statSync(stderrPath).size;
  const results = [];
  let offset = 0;
  for (const request of requests) {
    const end = output.indexOf(10, offset);
    if (end < 0) throw new Error("incomplete batch header");
    const header = output.subarray(offset, end).toString();
    const match = /^([a-f0-9]{40}) blob (\d+)$/.exec(header);
    if (!match) throw new Error(`unresolved authenticated locator: ${request.spec}: ${header}`);
    const bytes = Number(match[2]);
    const buffer = output.subarray(end + 1, end + 1 + bytes);
    if (buffer.length !== bytes || output[end + 1 + bytes] !== 10 || gitHash(buffer) !== match[1]) throw new Error("Git blob framing/identity failure");
    results.push({ ...request, blob: match[1], bytes, sha256: hash(buffer), text: buffer.toString("utf8") });
    offset = end + bytes + 2;
  }
  if (offset !== output.length) throw new Error("unexpected batch tail");
  return results;
}

function shape(value, depth = 0) {
  if (Array.isArray(value)) return { array: value.length, sample: value.slice(0, 2).map(item => depth < 3 ? shape(item, depth + 1) : item) };
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 35).map(([key, item]) => [key, depth < 3 ? shape(item, depth + 1) : typeof item]));
  return value;
}

const requests = [
  ["retained", stage, `${base}stage-b/RETAINED-SOURCES.json`],
  ["origins", curie, `${base}stage-b1-r2/STAGED-IMPORT-ORIGINS.json`],
  ["author-summary", author, `${n14}results-v5/SUMMARY.json`],
  ["author-executor", author, `${n14}run-v5.mjs`],
  ["author-n14", author, `${n14}n14.mjs`],
  ["owner", owner, `${base}stage-b0-r3/owner.mjs`],
  ["owner-run", owner, `${base}stage-b0-r3/run.mjs`],
  ["b1-run", curie, `${base}stage-b1-r2/run.mjs`],
  ["independent-result", independent, "tests/compatibility/bash-strict-extension-independent-20260829/n14-v2/actual-v2/evidence/RESULT.json"],
  ["producer-handoff", producer, `${base}stage-a-r2/HANDOFF.md`]
].map(([name, commit, originalPath]) => ({ name, commit, originalPath, spec: `${commit}:${originalPath}` }));

if (process.argv[2] !== "inspect") throw new Error("only SOURCE/DATA inspect is authorized");
const metadata = gitBatch(requests, "metadata-reader-01");
const retained = JSON.parse(metadata.find(row => row.name === "retained").text);
for (const row of retained) {
  const buffer = Buffer.from(row.text);
  if (row.bytes !== buffer.length || row.sha256 !== hash(buffer) || row.blob !== gitHash(buffer)) throw new Error(`inherited text identity mismatch: ${row.path}`);
}
const verified = gitBatch(retained.map(row => ({ name: row.path, commit: row.commit, originalPath: row.path, spec: `${row.commit}:${row.path}` })), "fixture-reader-02");
for (let index = 0; index < retained.length; index++) {
  if (retained[index].blob !== verified[index].blob || retained[index].sha256 !== verified[index].sha256) throw new Error("retained origin differs from authenticated original");
}
const data = { version, metadata, retained: verified, census: Object.freeze({ starts: [...localStarts], knownChildStarts: localStarts.length, peakKnownChildProcesses: 1, captureBytes, elapsedMs: performance.now() - started, productImports: 0, semanticCalls: 0, compilerCalls: 0, workers: 0, guestEngines: 0, profile: "known-role-only functional metadata reads; no OS containment/universal census/group absence claim" }) };
fs.writeFileSync(path.join(work, "inspection.json"), JSON.stringify(data), { flag: "wx" });
for (const row of metadata) {
  if (row.name === "origins" || row.name === "author-summary" || row.name === "independent-result") console.log(row.name, JSON.stringify(shape(JSON.parse(row.text))));
}
console.log("retained", JSON.stringify(verified.map(row => ({ path: row.originalPath, blob: row.blob, bytes: row.bytes, sha256: row.sha256 }))));
console.log("census", JSON.stringify(data.census));
