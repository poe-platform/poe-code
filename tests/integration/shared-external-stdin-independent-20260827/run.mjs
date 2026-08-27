import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, lstat, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baseline, cases, controls } from "./cases.mjs";

const fixtureCommit = "0ec75ef320ecaea9fc66e1ba952f3961c917685c";
const repository = "/Users/kjopek/Workspace/safe-bash";
const owned = "tests/integration/shared-external-stdin-independent-20260827";
const here = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
assert.ok(output?.startsWith("/tmp/shared-stdin-independent-"), "unique owned scratch output required");
await mkdir(output);
const scratch = await realpath(await mkdtemp("/tmp/shared-stdin-independent-work-"));
const source = path.join(scratch, "source");
const consumer = path.join(scratch, "moved-consumer");
const packageRoot = path.join(consumer, "node_modules/virtual-bash");
const fixtures = path.join(consumer, "fixtures");
const children = new Set();
const commands = [];
const started = new Date().toISOString();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async (filename, value) => writeFile(path.join(output, filename), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
async function snapshot(root) {
  const inventory = [];
  async function visit(relative) {
    const full = path.join(root, relative);
    const stat = await lstat(full);
    assert.ok(!stat.isSymbolicLink(), `symlink refused: ${full}`);
    if (stat.isDirectory()) {
      inventory.push({ path: relative || ".", kind: "directory", mode: stat.mode & 0o777 });
      for (const name of (await readdir(full)).sort()) await visit(path.join(relative, name));
    } else {
      assert.ok(stat.isFile(), `nonregular input: ${full}`);
      const bytes = await readFile(full);
      inventory.push({ path: relative, kind: "file", mode: stat.mode & 0o777, size: bytes.length, sha256: hash(bytes) });
    }
  }
  await visit("");
  return inventory;
}
async function child(label, executable, args, cwd, env = {}, timeout = 180000) {
  const began = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const processChild = spawn(executable, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    children.add(processChild);
    let stdout = "";
    let stderr = "";
    let expired = false;
    let overLimit = false;
    const timer = setTimeout(() => { expired = true; processChild.kill("SIGKILL"); }, timeout);
    const collect = stream => chunk => {
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
      if (stdout.length + stderr.length > 4 * 1024 * 1024) { overLimit = true; processChild.kill("SIGKILL"); }
    };
    processChild.stdout.on("data", collect("stdout"));
    processChild.stderr.on("data", collect("stderr"));
    processChild.on("error", error => { clearTimeout(timer); children.delete(processChild); reject(error); });
    processChild.on("close", (status, signal) => {
      clearTimeout(timer);
      children.delete(processChild);
      const receipt = { label, executable, args, cwd, began, ended: new Date().toISOString(), pid: processChild.pid, status, signal, expired, overLimit, stdout, stderr, closed: true };
      commands.push(receipt);
      resolve(receipt);
    });
  });
}
async function successful(...args) { const result = await child(...args); assert.equal(result.status, 0, `${result.label}: ${result.stderr}`); assert.equal(result.expired, false); return result; }
let failure;
try {
  assert.equal(git(["rev-parse", baseline]).toString().trim(), baseline);
  await mkdir(source);
  const archivePaths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "README.md", "AGENTS.md"];
  const tree = git(["ls-tree", "-rz", baseline, "--", ...archivePaths]).toString().split("\0").filter(Boolean).map(line => {
    const [metadata, filename] = line.split("\t");
    const [mode, type, blob] = metadata.split(" ");
    assert.equal(type, "blob");
    assert.ok(mode === "100644" || mode === "100755");
    return { path: filename, mode, blob };
  });
  const archivePath = path.join(scratch, "source.tar");
  const archived = await successful("git-archive", "git", ["archive", "--format=tar", `--output=${archivePath}`, baseline, "--", ...archivePaths], repository);
  await successful("extract-source", "tar", ["-xf", archivePath, "-C", source], repository);
  for (const entry of tree) {
    const bytes = await readFile(path.join(source, entry.path));
    const blob = git(["cat-file", "blob", entry.blob]);
    assert.ok(bytes.equals(blob), `archived blob mismatch ${entry.path}`);
    entry.sha256 = hash(bytes);
    entry.size = bytes.length;
  }
  const sourceOriginal = await snapshot(source);
  await mkdir(path.join(source, "node_modules"));
  for (const dependency of ["typescript", "@types/node", "undici-types"]) {
    const destination = path.join(source, "node_modules", dependency);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repository, "node_modules", dependency), destination, { recursive: true, dereference: true, preserveTimestamps: true });
    assert.deepEqual(await snapshot(destination), await snapshot(await realpath(path.join(repository, "node_modules", dependency))));
  }
  const toolManifest = await snapshot(path.join(source, "node_modules"));
  await successful("compile-exact-source", process.execPath, [path.join(source, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], source);
  const buildBefore = await snapshot(source);
  const npmCli = await realpath(path.join(path.dirname(process.execPath), "npm"));
  await mkdir(path.join(scratch, "packed"));
  const packed = await successful("npm-pack", process.execPath, [npmCli, "pack", "--ignore-scripts", "--json", "--pack-destination", path.join(scratch, "packed")], source, { npm_config_cache: path.join(scratch, "npm-cache"), npm_config_offline: "true", npm_config_ignore_scripts: "true", npm_config_audit: "false", NODE_OPTIONS: "" });
  const pack = JSON.parse(packed.stdout)[0];
  assert.equal(pack.name, "virtual-bash");
  const tarball = path.join(scratch, "packed", pack.filename);
  const tarBytes = await readFile(tarball);
  assert.equal(`sha512-${createHash("sha512").update(tarBytes).digest("base64")}`, pack.integrity);
  await mkdir(path.join(scratch, "unpacked"));
  await successful("unpack-package", "tar", ["-xzf", tarball, "-C", path.join(scratch, "unpacked")], repository);
  await mkdir(path.dirname(packageRoot), { recursive: true });
  await rename(path.join(scratch, "unpacked/package"), packageRoot);
  await mkdir(fixtures);
  for (const filename of ["cases.mjs", "probe.mjs", "loader.mjs"]) {
    const bytes = git(["show", `${fixtureCommit}:${owned}/${filename}`]);
    assert.ok(bytes.equals(await readFile(path.join(here, filename))), `fixture changed after freeze: ${filename}`);
    await writeFile(path.join(fixtures, filename), bytes, { flag: "wx" });
  }
  const consumerBefore = await snapshot(consumer);
  for (const entry of consumerBefore.filter(entry => entry.path.startsWith("node_modules/virtual-bash/dist/") && entry.kind === "file")) {
    const corresponding = buildBefore.find(item => item.path === entry.path.slice("node_modules/virtual-bash/".length));
    assert.ok(corresponding && corresponding.sha256 === entry.sha256, `moved package not the build ${entry.path}`);
  }
  const runtime = { executable: await realpath(process.execPath), version: process.version, sha256: hash(await readFile(process.execPath)), npmCli, npmSha256: hash(await readFile(npmCli)), platform: process.platform, arch: process.arch };
  await json("authentication.json", { baseline, fixtureCommit, runtime, scratch, source, consumer, archive: { command: archived.args, sha256: hash(await readFile(archivePath)), tree }, sourceOriginal, toolManifest, buildBefore, consumerBefore, pack: { ...pack, sha256: hash(tarBytes) }, appendProof: "full directory-entry/type/mode/file-byte inventory equality before/after including new entries; not merely original tracked path hashes", scope: "committed production source/config/README/AGENTS archive; 32 independently frozen probes; not a whole repository test gate" });
  const rows = [];
  const loadManifests = [];
  const execute = async (id, mutant = "none") => {
    const label = mutant === "none" ? id : `control-${mutant}`;
    const report = path.join(output, `${label}.json`);
    const receiptPath = path.join(output, `${label}.loads.jsonl`);
    const execution = await child(label, process.execPath, ["--unhandled-rejections=strict", "--experimental-loader", path.join(fixtures, "loader.mjs"), path.join(fixtures, "probe.mjs"), id, report, mutant], consumer, { NODE_OPTIONS: "", INDEPENDENT_ALLOWED_ROOTS: JSON.stringify([fixtures, packageRoot]), INDEPENDENT_LOAD_RECEIPT: receiptPath }, 60000);
    let result;
    try { result = JSON.parse(await readFile(report, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const loads = (await readFile(receiptPath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    for (const load of loads) {
      const relative = path.relative(consumer, load.filename);
      const authenticated = consumerBefore.find(entry => entry.path === relative);
      assert.ok(authenticated && authenticated.sha256 === load.sha256, `unbound loaded module ${load.filename}`);
    }
    assert.ok(loads.some(load => load.filename === path.join(packageRoot, "dist/index.js")), "actual packed root public entry loaded");
    assert.ok(loads.some(load => load.filename === path.join(packageRoot, "dist/shell/input.js")), "compiled input module actually loaded");
    loadManifests.push({ label, count: loads.length, sha256: hash(await readFile(receiptPath)), modules: loads });
    const row = { id, mutant, status: execution.status, signal: execution.signal, expired: execution.expired, closed: execution.closed, pass: execution.status === 0 && result?.pass === true, result: result ?? null };
    rows.push(row);
    console.log(`${label}: status=${execution.status} pass=${row.pass} ${result?.failure?.message ?? ""}`);
    if (execution.expired || execution.overLimit) throw new Error(`unwaived watchdog/output failure: ${label}`);
    return row;
  };
  for (const spec of cases) await execute(spec.id);
  await json("baseline-cohort.json", { baseline, fixtureCommit, rows: [...rows], count: cases.length, passes: rows.filter(row => row.pass).length, failures: rows.filter(row => !row.pass).map(row => row.id) });
  for (const control of controls) {
    const row = await execute(control.case, control.id);
    assert.equal(row.pass, false, `negative control did not fail: ${control.id}`);
    if (control.id === "bad-swallow") assert.ok(row.result?.failure?.message.includes("expected rejection"));
    else { assert.equal(row.result, null); assert.ok(commands.at(-1).stderr.includes("independent-late-return")); }
    assert.equal(row.status, 1, `unexpected control exit ${control.id}`);
  }
  const buildAfter = await snapshot(source);
  const consumerAfter = await snapshot(consumer);
  assert.deepEqual(buildAfter, buildBefore, "source/build/tool inventory changed or gained entries");
  assert.deepEqual(consumerAfter, consumerBefore, "moved consumer/package/fixtures changed or gained entries");
  await json("integrity-after.json", { buildAfter, consumerAfter, appendProof: true, sourceArchiveSha256: hash(await readFile(archivePath)), packageSha256: hash(await readFile(tarball)), runtimeSha256: hash(await readFile(process.execPath)), ownedActiveChildren: children.size });
  await json("loaded-modules.json", loadManifests);
  await json("summary.json", { baseline, fixtureCommit, started, ended: new Date().toISOString(), behaviorCount: cases.length, behaviorPasses: rows.filter(row => row.mutant === "none" && row.pass).length, behaviorFailures: rows.filter(row => row.mutant === "none" && !row.pass).map(row => row.id), controlsDetected: rows.filter(row => row.mutant !== "none" && !row.pass).length, childrenClosed: commands.every(command => command.closed), watchdogExpiries: commands.filter(command => command.expired).length, state: "BASELINE_ONLY_WAITING_FOR_EXPLICIT_ROOT_CANDIDATE", candidateNotInspected: true, scratchRetained: scratch, scratchPolicy: "Unique inert archives retained for audit; no processes or servers left running. No broad cleanup." });
} catch (error) { failure = error; await json("runner-failure.json", { message: String(error), stack: error.stack, scratch }); }
finally {
  for (const ownedChild of children) ownedChild.kill("SIGKILL");
  await Promise.all([...children].map(ownedChild => new Promise(resolve => ownedChild.once("close", resolve))));
  await json("commands.json", commands);
  assert.equal(children.size, 0);
}
if (failure) throw failure;
console.log(`Evidence: ${output}`);
