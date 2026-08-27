import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, lstat, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [priorOutput, output] = process.argv.slice(2);
assert.ok(output?.startsWith("/tmp/shared-stdin-independent-candidate-"));
await mkdir(output);
const prior = JSON.parse(await readFile(path.join(priorOutput, "authentication.json"), "utf8"));
assert.equal(prior.candidate, "f8819e9d6b6d535b0626e0aa004bb10a7bc36785");
const scratch = await realpath(await mkdtemp("/tmp/shared-stdin-independent-candidate-falsy-"));
const consumer = path.join(scratch, "consumer"), fixtures = path.join(consumer, "fixtures"), packageRoot = path.join(consumer, "node_modules/virtual-bash");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async (filename, value) => writeFile(path.join(output, filename), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
async function snapshot(root) {
  const result = [];
  async function visit(relative) {
    const full = path.join(root, relative), stat = await lstat(full);
    assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) { result.push({ path: relative || ".", kind: "directory", mode: stat.mode & 0o777 }); for (const name of (await readdir(full)).sort()) await visit(path.join(relative, name)); }
    else { assert.ok(stat.isFile()); const bytes = await readFile(full); result.push({ path: relative, kind: "file", mode: stat.mode & 0o777, size: bytes.length, sha256: hash(bytes) }); }
  }
  await visit(""); return result;
}
assert.deepEqual(await snapshot(prior.source), prior.buildBefore);
assert.deepEqual(await snapshot(prior.consumer), prior.consumerBefore);
await mkdir(path.dirname(packageRoot), { recursive: true });
await cp(path.join(prior.consumer, "node_modules/virtual-bash"), packageRoot, { recursive: true, preserveTimestamps: true });
assert.deepEqual(await snapshot(packageRoot), await snapshot(path.join(prior.consumer, "node_modules/virtual-bash")));
await mkdir(fixtures);
await cp(path.join(here, "falsy-probe.mjs"), path.join(fixtures, "falsy-probe.mjs"));
await cp(path.join(prior.consumer, "provisional35/loader.mjs"), path.join(fixtures, "loader.mjs"));
const freezeCommit = execFileSync("git", ["log", "-1", "--format=%H", "--", "falsy-probe.mjs", "falsy-run.mjs", "falsy-FREEZE.md"], { cwd: here }).toString().trim();
for (const filename of ["falsy-probe.mjs", "falsy-run.mjs"]) assert.ok(execFileSync("git", ["show", `${freezeCommit}:tests/integration/shared-external-stdin-independent-20260827/candidate-review/${filename}`], { cwd: here }).equals(await readFile(path.join(here, filename))));
const before = await snapshot(consumer);
await json("authentication.json", { candidate: prior.candidate, freezeCommit, frozenBeforeExecution: true, started: new Date().toISOString(), consumer, packageRoot, before, runtime: prior.runtime, sourceArchiveSha256: prior.archive.sha256, packageSha256: prior.pack.sha256 });
const receiptPath = path.join(output, "loads.jsonl");
const command = await new Promise((resolve, reject) => {
  const args = ["--unhandled-rejections=strict", "--experimental-loader", path.join(fixtures, "loader.mjs"), path.join(fixtures, "falsy-probe.mjs"), path.join(output, "results.json")];
  const child = spawn(process.execPath, args, { cwd: consumer, env: { ...process.env, NODE_OPTIONS: "", INDEPENDENT_ALLOWED_ROOTS: JSON.stringify([fixtures, packageRoot]), INDEPENDENT_LOAD_RECEIPT: receiptPath }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", expired = false, overLimit = false;
  const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 60000);
  const collect = channel => bytes => { if (channel === "stdout") stdout += bytes; else stderr += bytes; if (stdout.length + stderr.length > 4 * 1024 * 1024) { overLimit = true; child.kill("SIGKILL"); } };
  child.stdout.on("data", collect("stdout")); child.stderr.on("data", collect("stderr"));
  child.on("error", error => { clearTimeout(timer); reject(error); });
  child.on("close", (status, signal) => { clearTimeout(timer); resolve({ args, pid: child.pid, status, signal, stdout, stderr, expired, overLimit, closed: true }); });
});
await json("command.json", command);
const after = await snapshot(consumer);
assert.deepEqual(after, before);
assert.deepEqual(await snapshot(prior.source), prior.buildBefore);
assert.deepEqual(await snapshot(prior.consumer), prior.consumerBefore);
const loaded = (await readFile(receiptPath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
for (const entry of loaded) assert.equal(before.find(item => item.path === path.relative(consumer, entry.filename))?.sha256, entry.sha256);
assert.ok(loaded.some(entry => entry.filename === path.join(packageRoot, "dist/shell/input.js")));
await json("integrity-after.json", { after, loaded, appendProof: true, originalSourceAndConsumerUnchanged: true, ownedActiveChildren: 0 });
assert.equal(command.expired, false); assert.equal(command.overLimit, false);
const report = JSON.parse(await readFile(path.join(output, "results.json"), "utf8"));
await json("summary.json", { count: report.rows.length, passes: report.rows.filter(row => row.pass).length, failures: report.rows.filter(row => !row.pass).map(row => row.id), status: command.status, closed: true, ownedActiveChildren: 0 });
console.log(`Falsy evidence: ${output}`);
