import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, lstat, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
const base = "tests/integration/shared-external-stdin-independent-20260827";
const owned = `${base}/fixture-v2`;
const here = path.dirname(fileURLToPath(import.meta.url));
const candidate = "f8819e9d6b6d535b0626e0aa004bb10a7bc36785";
const priorCommit = "d9a58cdc1d4fee159e21c76c708267628767bbf4";
const [output, fixtureCommit] = process.argv.slice(2);
assert.ok(output?.startsWith("/tmp/shared-stdin-fixture-v2-"));
assert.equal(path.dirname(output), "/tmp");
assert.equal(fixtureCommit?.length, 40, "explicit fixture-only commit required");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
assert.equal(git(["rev-parse", `${fixtureCommit}^{commit}`]).toString().trim(), fixtureCommit);
await mkdir(output);
const json = async (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const children = new Set();
const commands = [];
const started = new Date().toISOString();
let scratch;
let failure;

async function snapshot(root) {
  const inventory = [];
  async function visit(relative) {
    const full = path.join(root, relative);
    const stat = await lstat(full);
    assert.equal(stat.isSymbolicLink(), false, `symlink refused: ${full}`);
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

async function child(label, args, cwd, env) {
  return new Promise(resolve => {
    const began = new Date().toISOString();
    const processChild = spawn(process.execPath, args, { cwd, env: { ...process.env, NODE_OPTIONS: "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
    children.add(processChild);
    let stdout = "";
    let stderr = "";
    let spawnError;
    let expired = false;
    let overLimit = false;
    const timer = setTimeout(() => { expired = true; processChild.kill("SIGKILL"); }, 60000);
    const collect = stream => chunk => {
      if (stream === "stdout") stdout += chunk;
      else stderr += chunk;
      if (stdout.length + stderr.length > 4 * 1024 * 1024) { overLimit = true; processChild.kill("SIGKILL"); }
    };
    processChild.stdout.on("data", collect("stdout"));
    processChild.stderr.on("data", collect("stderr"));
    processChild.on("error", error => { spawnError = String(error); });
    processChild.on("close", (status, signal) => {
      clearTimeout(timer);
      children.delete(processChild);
      const receipt = { label, executable: process.execPath, args, cwd, began, ended: new Date().toISOString(), pid: processChild.pid, status, signal, expired, overLimit, spawnError, stdout, stderr, closed: true };
      commands.push(receipt);
      resolve(receipt);
    });
  });
}

try {
  const freezeBytes = await readFile(path.join(here, "FREEZE.json"));
  assert.deepEqual(freezeBytes, git(["show", `${fixtureCommit}:${owned}/FREEZE.json`]));
  const freeze = JSON.parse(freezeBytes);
  for (const entry of freeze.files) {
    const bytes = await readFile(path.join(here, entry.path));
    assert.equal(hash(bytes), entry.sha256, `frozen file changed: ${entry.path}`);
    assert.equal(bytes.length, entry.size);
    assert.deepEqual(bytes, git(["show", `${fixtureCommit}:${owned}/${entry.path}`]));
  }
  const priorPath = `${base}/candidate-review/evidence/replay/authentication.json`;
  const priorBytes = git(["show", `${priorCommit}:${priorPath}`]);
  assert.equal(hash(priorBytes), "2b8db1a8be77cb98c555f33ec7d7e4410295b20505b0887197f2c68e73a674d9");
  const prior = JSON.parse(priorBytes);
  assert.equal(prior.candidate, candidate);
  assert.equal(process.version, prior.runtime.version);
  assert.equal(process.platform, prior.runtime.platform);
  assert.equal(process.arch, prior.runtime.arch);
  const archivePath = path.join(prior.scratch, "source.tar");
  const tarball = path.join(prior.scratch, "packed", prior.pack.filename);
  async function authenticatePrior() {
    const sourceInventory = await snapshot(prior.source);
    const consumerInventory = await snapshot(prior.consumer);
    assert.deepEqual(sourceInventory, prior.buildBefore, "prior source/build/tools changed, including new entries");
    assert.deepEqual(consumerInventory, prior.consumerBefore, "prior moved consumer changed, including new entries");
    const identities = {
      archiveSha256: hash(await readFile(archivePath)),
      packageSha256: hash(await readFile(tarball)),
      inputTsSha256: hash(await readFile(path.join(prior.source, "src/shell/input.ts"))),
      loadedInputJsSha256: hash(await readFile(path.join(prior.consumer, "node_modules/virtual-bash/dist/shell/input.js"))),
      runtimeSha256: hash(await readFile(process.execPath)),
      sourceInventorySha256: hash(JSON.stringify(sourceInventory)),
      consumerInventorySha256: hash(JSON.stringify(consumerInventory)),
      sourceEntryCount: sourceInventory.length,
      consumerEntryCount: consumerInventory.length,
    };
    assert.equal(identities.archiveSha256, prior.archive.sha256);
    assert.equal(identities.packageSha256, "62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6");
    assert.equal(identities.inputTsSha256, "4214a448a1a076acb297c3ba6a02d72482d488cf8b6df4549498148a012e5c32");
    assert.equal(identities.loadedInputJsSha256, "f8b984b6fc338ff3d1ca60e10283ab100d8e62a697f4b7f8e691819c28ea7c4a");
    assert.equal(identities.runtimeSha256, prior.runtime.sha256);
    return identities;
  }
  const priorBefore = await authenticatePrior();
  for (const entry of prior.archive.tree) {
    assert.deepEqual(await readFile(path.join(prior.source, entry.path)), git(["show", `${candidate}:${entry.path}`]), `candidate Git source binding: ${entry.path}`);
  }
  scratch = await realpath(await mkdtemp("/tmp/shared-stdin-fixture-v2-work-"));
  const staging = path.join(scratch, "unmoved-consumer");
  const consumer = path.join(scratch, "moved-consumer");
  await mkdir(path.join(staging, "node_modules"), { recursive: true });
  await cp(path.join(prior.consumer, "node_modules/virtual-bash"), path.join(staging, "node_modules/virtual-bash"), { recursive: true, errorOnExist: true, force: false });
  await mkdir(path.join(staging, "fixtures"));
  for (const name of freeze.executionFiles) await cp(path.join(here, name), path.join(staging, "fixtures", name), { errorOnExist: true, force: false });
  await rename(staging, consumer);
  const packageRoot = path.join(consumer, "node_modules/virtual-bash");
  const fixtures = path.join(consumer, "fixtures");
  const consumerBefore = await snapshot(consumer);
  const packageEntries = inventory => inventory.filter(entry => entry.path === "node_modules/virtual-bash" || entry.path.startsWith("node_modules/virtual-bash/"));
  assert.deepEqual(packageEntries(consumerBefore), packageEntries(prior.consumerBefore));
  for (const entry of prior.pack.files) {
    const copied = consumerBefore.find(item => item.path === `node_modules/virtual-bash/${entry.path}`);
    assert.equal(copied?.size, entry.size);
    assert.equal(copied?.mode, entry.mode);
  }
  await json("authentication.json", { candidate, fixtureCommit, freezeSha256: hash(freezeBytes), priorCommit, priorPath, priorSha256: hash(priorBytes), priorBefore, runtime: prior.runtime, scratch, consumer, consumerBefore, historicalInventories: "Full source/build/tools and old-consumer entry inventories are referenced by the immutable prior authentication SHA; full equality checked, not original-path-only hashing", packageCopy: "Exact prior npm-packed moved package copied to fresh consumer, then moved; no rebuild, repack, live HEAD or live dist" });
  const executions = [];
  async function execute(label, script, args, column = false) {
    const report = path.join(output, `${label}.json`);
    const loadsFile = path.join(output, `${label}.loads.jsonl`);
    const scriptPath = path.join(fixtures, script);
    const execution = await child(label, ["--unhandled-rejections=strict", "--experimental-loader", path.join(fixtures, "loader.mjs"), scriptPath, ...args, report], consumer, { INDEPENDENT_ALLOWED_ROOTS: JSON.stringify([fixtures, packageRoot]), INDEPENDENT_LOAD_RECEIPT: loadsFile });
    let result;
    try { result = JSON.parse(await readFile(report, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const loadsBytes = await readFile(loadsFile);
    const loads = loadsBytes.toString().trim().split("\n").map(line => JSON.parse(line));
    for (const load of loads) {
      const authenticated = consumerBefore.find(entry => entry.path === path.relative(consumer, load.filename));
      assert.equal(load.sha256, authenticated?.sha256, `unbound loaded module: ${load.filename}`);
      assert.equal(load.size, authenticated.size);
    }
    for (const filename of [scriptPath, path.join(packageRoot, "dist/index.js"), path.join(packageRoot, "dist/shell/input.js")]) assert.ok(loads.some(load => load.filename === filename), `required actual loaded module: ${filename}`);
    if (column) assert.ok(loads.some(load => load.filename === path.join(packageRoot, "dist/commands/column/index.js")));
    const row = { label, status: execution.status, signal: execution.signal, expired: execution.expired, overLimit: execution.overLimit, closed: execution.closed, loadedCount: loads.length, loadsSha256: hash(loadsBytes), pass: execution.status === 0 && (column ? result?.rows?.length === 6 && result.rows.every(item => item.pass) : result?.pass === true), result: result ?? null };
    executions.push(row);
    console.log(`${label}: status=${row.status} pass=${row.pass}`);
    assert.equal(row.expired, false, "60-second exact-child watchdog expiry is not waived");
    assert.equal(row.overLimit, false, "output limit is not waived");
    return row;
  }
  const { cases } = await import(path.join(fixtures, "cases.mjs"));
  assert.equal(cases.length, 35);
  assert.equal(new Set(cases.map(spec => spec.id)).size, 35);
  const main = [];
  for (const spec of cases) main.push(await execute(spec.id, "probe.mjs", [spec.id]));
  const column = await execute("column6", "column-close.mjs", [packageRoot], true);
  const negatives = [];
  for (const id of ["shell-primary-read-zero", "shell-primary-read-error"]) {
    const row = await execute(`wrong-primary-${id}`, "probe-wrong-primary.mjs", [id]);
    const expectedDiagnostic = `shell: line 1: ${id.endsWith("zero") ? "0" : "independent-primary-failure"}\n`;
    const line = (await readFile(path.join(fixtures, "probe-wrong-primary.mjs"), "utf8")).split("\n").findIndex(text => text.includes('assert.equal(errors.join(""), `shell: line 1: ${closeError.message}')) + 1;
    row.detected = row.status === 1 && row.result?.pass === false && row.result.failure?.name === "AssertionError" && row.result.failure.stack.includes(`probe-wrong-primary.mjs:${line}:`) && row.result.failure.message.includes("independent-return-failure") && row.result.stderr.join("") === expectedDiagnostic && row.result.input.reads === 1 && row.result.input.returns === 1 && row.result.output.length === 0;
    negatives.push(row);
  }
  const wrongColumn = await execute("wrong-column-code6", "column-wrong-code.mjs", [packageRoot], true);
  const wrongLine = (await readFile(path.join(fixtures, "column-wrong-code.mjs"), "utf8")).split("\n").findIndex(text => text.includes('assert.equal(Buffer.concat(errors).toString(), "column: EIO:')) + 1;
  wrongColumn.detected = wrongColumn.status === 1 && wrongColumn.result?.rows?.length === 6 && wrongColumn.result.rows.every(row => !row.pass && row.failure.stack.includes(`column-wrong-code.mjs:${wrongLine}:`) && row.failure.message.includes("EIO") && row.observed.stderr === "column: EFBIG: column input limit exceeded\n" && row.observed.reads === 1 && row.observed.returns === 1 && row.observed.stdoutHex === "");
  negatives.push(wrongColumn);
  await json("cohorts.json", { main: { name: "authorized-v2-35", count: 35, passes: main.filter(row => row.pass).length, failures: main.filter(row => !row.pass).map(row => row.label) }, column: { name: "authorized-v2-column6", count: 6, passes: column.result?.rows?.filter(row => row.pass).length ?? 0, status: column.status }, negativeAssertions: { executions: negatives.length, rows: 8, detectedExecutions: negatives.filter(row => row.detected).length, details: negatives }, executions: executions.map(({ result, ...receipt }) => receipt) });
  const priorAfter = await authenticatePrior();
  const consumerAfter = await snapshot(consumer);
  assert.deepEqual(priorAfter, priorBefore);
  assert.deepEqual(consumerAfter, consumerBefore, "new consumer changed, including new entries");
  for (const entry of freeze.files) assert.equal(hash(await readFile(path.join(here, entry.path))), entry.sha256);
  await json("integrity-after.json", { priorAfter, consumerInventorySha256: hash(JSON.stringify(consumerAfter)), consumerEntryCount: consumerAfter.length, fullEntryInventoryEqual: true, appendProof: true, checks: "Complete before/after directory/file type, mode, size and byte inventory equality, detecting new entries; original full inventories bound by committed prior authentication", fixtureFilesUnchanged: true, activeOwnedChildren: children.size });
  await json("summary.json", { candidate, fixtureCommit, started, ended: new Date().toISOString(), mainPasses: main.filter(row => row.pass).length, mainCount: 35, columnPasses: column.result?.rows?.filter(row => row.pass).length ?? 0, columnCount: 6, negativeAssertionExecutions: negatives.length, negativeAssertionRows: 8, negativeAssertionExecutionsDetected: negatives.filter(row => row.detected).length, historicalNegativeExecutions: 4, historical: { originalBaseline: "18/32", originalCandidate: "24/32", provisionalBaseline: "25/35", provisionalCandidate: "33/35", column: "0/6", originalAuthor: "34 cases / nine fixed observations retained", falsy: "5/5 separately at bdb49bb1" }, watchdogExpiries: commands.filter(command => command.expired).length, childrenClosed: commands.every(command => command.closed), activeOwnedChildren: children.size, scratchRetained: scratch, sourceChanged: false, authorOnly: true, reviewer: "WAITING", publicIntegration: "HOLD" });
  assert.ok(main.every(row => row.pass) && column.pass && negatives.every(row => row.detected), "Actual failures preserved; author replay is not all expected results");
} catch (error) {
  failure = error;
  await json("runner-failure.json", { message: String(error), stack: error.stack, scratch });
} finally {
  const remaining = [...children];
  const closed = remaining.map(ownedChild => new Promise(resolve => ownedChild.once("close", resolve)));
  for (const ownedChild of remaining) ownedChild.kill("SIGKILL");
  await Promise.all(closed);
  await json("commands.json", commands);
  assert.equal(children.size, 0);
}
if (failure) throw failure;
console.log(`Author replay evidence: ${output}; different reviewer WAITING, public integration HOLD`);
