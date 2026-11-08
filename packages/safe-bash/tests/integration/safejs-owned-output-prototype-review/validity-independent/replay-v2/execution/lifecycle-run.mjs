import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyRegular, git, inventory, load, owner, privateState, record, repository, serialize, sha, state, verifyOriginal } from "/private/tmp/safe-bash-independent-v2-inputs-5dho_5db/lifecycle/execution-v2/common.mjs";

import { verifyProfile } from "/private/tmp/safe-bash-independent-v2-inputs-5dho_5db/lifecycle/execution-v2/profile.mjs";

const directory = "/private/tmp/safe-bash-independent-v2-inputs-5dho_5db/lifecycle/execution-v2";
const lifecycle = resolve(directory, "..");
assert.equal(process.cwd(), repository);
assert.equal(process.argv.length, 3, "Usage: node execution-v2/run.mjs NEW_OWNED_EVIDENCE_DIRECTORY");
const output = resolve(process.argv[2]);
assert.ok(output.startsWith("/private/tmp/safe-bash-independent-v2-inputs-5dho_5db/independent-results/"));
assert.equal(existsSync(output), false, "Preserve every previous attempt");
mkdirSync(output, { recursive: true });
const save = (name, value) => writeFileSync(join(output, name), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const cases = load(join(directory, "CASES.json"));
const revision = load(join(directory, "REVISION.json"));
const variantId = row => revision.variants[row.id]?.variantId ?? row.id;
const pins = load(join(lifecycle, "SOURCE-PINS.json"));
const runnerFreeze = load(join(directory, "RUNNER-FREEZE.json"));
const report = { started: new Date().toISOString(), status: "RUNNING", originalFreeze: "c8df5cf2819d7ad9d54c2a70800258c7c200665a",
  receiptReview: "07a7dae5db51612a23e74d1d164d33723d4d61b6", reportCorrection: "db139ae983ad66364e0367f9fb1ed0262ee61f63",
  profile: revision, source: pins.staticReadEquality.sourceManifestSha256, rows: [], children: [], imports: [], guardChecks: [],
  scopes: { runtime: "Independent exact-child eleven-row replay: eight unchanged controls and three approved revised bindings", product: "TEMP prototype; not frozen production8670 acceptance", private: "Readonly actual checkout, regular unchanged engine copies only" } };
function independentDirectoryShape(roots) {
  const output = {};
  for (const root of roots) {
    const entries = [];
    const visit = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        assert.ok(entry.isDirectory() || entry.isFile(), `Nonregular independent input: ${entry.name}`);
        const filename = join(directory, entry.name);
        entries.push({ path: relative(root, filename), kind: entry.isDirectory() ? "directory" : "file" });
        if (entry.isDirectory()) visit(filename);
      }
    };
    visit(root); output[root] = entries;
  }
  return output;
}
let independentShapes;

let temporary;
let immutable;
let sharedBefore;
let sharedRoots;
let before;
let activeChild;
let environment;
function verifyRunner() {
  for (const entry of runnerFreeze.files) {
    assert.equal(record(join(directory, entry.path)).sha256, entry.sha256, entry.path);
    const filename = `tests/integration/safejs-owned-output-prototype-review/lifecycle/execution-v2/${entry.path}`;
    assert.equal(sha(git(repository, "show", `3f6db4dd29950d92410a4d4f9871ba18a5b56e89:${filename}`)), entry.sha256, `Runner must be committed before guests: ${filename}`);
  }
  assert.equal(sha(git(repository, "show", `3f6db4dd29950d92410a4d4f9871ba18a5b56e89:${owner}/execution-v2/RUNNER-FREEZE.json`)), record(join(directory, "RUNNER-FREEZE.json")).sha256);
  return "3f6db4dd29950d92410a4d4f9871ba18a5b56e89";
}
function currentImmutable() {
  return Object.fromEntries(["product", "engine", "node_modules", "consumer/node_modules/virtual-bash", "consumer/harness"].map(name => [name, inventory(join(temporary, name), new Set(), true)]));
}
function verifyCopies(phase) {
  assert.deepEqual(currentImmutable(), immutable, `Immutable regular-file set/metadata changed: ${phase}`);
  assert.equal(record(join(temporary, "loader.mjs")).sha256, pins.loader.sha256);
  report.guardChecks.push({ phase, at: new Date().toISOString(), unchanged: true, newRegularFilesDetected: true, newSymlinksRefused: true, emptyDirectoryAdditionsDetected: false });
}
async function launch(row, deadline) {
  const started = new Date().toISOString();
  const args = ["--max-old-space-size=256", "--unhandled-rejections=strict", "--import", pathToFileURL(join(temporary, "consumer/harness/guard.mjs")).href,
    "--import", pathToFileURL(join(temporary, "loader.mjs")).href, join(temporary, "consumer/harness/child.mjs")];
  const child = spawn(process.execPath, args, { cwd: join(temporary, "consumer"), env: { ...environment, LIFECYCLE_ROW: row.id, SURFACE_IMPORTS: join(temporary, "logs", `${row.id}.imports.ndjson`) }, stdio: ["ignore", "pipe", "pipe"] });
  activeChild = child;
  const chunks = { stdout: [], stderr: [] };
  let size = 0;
  let contained;
  let error;
  const contain = cause => { if (!contained) { contained = cause; child.kill("SIGKILL"); } };
  const timer = setTimeout(() => contain("parent-watchdog"), Math.min(cases.containment.supervisorDeadlineMs, deadline - Date.now()));
  for (const stream of ["stdout", "stderr"]) child[stream].on("data", bytes => {
    size += bytes.length;
    if (size > cases.containment.childOutputMaxBytes) contain("output-limit");
    else chunks[stream].push(bytes);
  });
  child.on("error", failure => { error = serialize(failure); });
  const closed = await new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  clearTimeout(timer); activeChild = undefined;
  const entry = { id: row.id, variantId: variantId(row), pid: child.pid, command: process.execPath, args, cwd: join(temporary, "consumer"), started, closed: new Date().toISOString(), ...closed, error, containment: contained ?? null, outputBytes: size };
  report.children.push(entry);
  save(`${row.id}.stdout.txt`, Buffer.concat(chunks.stdout).toString());
  save(`${row.id}.stderr.txt`, Buffer.concat(chunks.stderr).toString());
  for (const suffix of ["json", "imports.ndjson", "guard.ndjson"]) {
    const filename = `${row.id}.${suffix}`;
    if (existsSync(join(temporary, "logs", filename))) save(filename, readFileSync(join(temporary, "logs", filename), "utf8"));
  }
  const filename = join(output, `${row.id}.json`);
  const detail = existsSync(filename) ? load(filename) : undefined;
  const classification = contained || closed.signal || !detail ? "FAIL" : detail.classification;
  if (classification === "PASS") assert.equal(closed.code, 0);
  return { id: row.id, variantId: variantId(row), classification, engineRuns: detail?.engineRuns ?? 0, childExit: closed.code, signal: closed.signal, containment: !!contained || !!detail?.containment, reportPresent: !!detail, fatal: detail?.fatal };
}
try {
  before = privateState();
  save("private-before.json", before);
  report.profileProof = verifyProfile();
  report.originalInputs = verifyOriginal();
  report.runnerCommit = verifyRunner();
  assert.equal(process.version, pins.node.version); assert.equal(process.platform, pins.node.platform); assert.equal(process.arch, pins.node.arch);
  assert.equal(record(process.execPath).sha256, pins.node.sha256);
  const receiptRoot = "tests/integration/safejs-owned-output-prototype-review/receipt-review";
  const receiptBindings = [
    [report.receiptReview, `${receiptRoot}/attempts/r2/proof.json`], [report.receiptReview, `${receiptRoot}/verification.json`],
    [report.reportCorrection, `${receiptRoot}/REPORT.md`],
  ];
  report.receipts = receiptBindings.map(([commit, filename]) => {
    const expected = git(repository, "show", `${commit}:${filename}`);
    assert.equal(sha(readFileSync(join(repository, filename))), sha(expected));
    return { commit, path: filename, sha256: sha(expected) };
  });
  const proof = load(join(repository, receiptRoot, "attempts/r2/proof.json"));
  const verification = load(join(repository, receiptRoot, "verification.json"));
  assert.equal(proof.status, "QUALIFIED_ACCEPT_ASSEMBLY_ONLY");
  assert.equal(verification.independentResultAssertions, "PASS");
  assert.equal(verification.actualSourceRouteFiles, 940); assert.equal(verification.actualPackagedRouteFiles, 940);
  assert.equal(proof.privateClosure.unchanged, true);
  assert.deepEqual(before, load(join(lifecycle, "execution-v1/evidence/attempt-01/private-after.json")), "Fresh private state drift from original accepted engine profile");
  assert.equal(before.head, pins.privateExpectedAtRelease.head);
  assert.equal(before.engine.length, 264);
  for (const [filename, info] of Object.entries(before.metadata)) assert.equal(info.sha256, pins.privateExpectedAtRelease.metadata[filename].sha256, filename);
  report.publicBefore = { ...state(repository), source: inventory(join(repository, "src")) };
  const prepared = pins.preparedReadOnlyRoot;
  sharedRoots = [prepared, proof.routes.sourceRoute, proof.routes.packagedRoute];
  sharedBefore = Object.fromEntries(sharedRoots.map(root => [root, inventory(root, new Set(), true)]));
  save("shared-before.json", sharedBefore);
  const assembly = load(join(repository, "tests/integration/safejs-owned-output-prototype-review/provenance/assembly.json"));
  for (const root of [proof.routes.sourceRoute, proof.routes.packagedRoute, assembly.candidate]) assert.deepEqual(inventory(root), assembly.candidateFiles);
  assert.equal(sha(JSON.stringify(assembly.candidateFiles.filter(entry => entry.path.startsWith("src/")))), report.source);
  temporary = realpathSync(mkdtempSync("/private/tmp/safe-bash-independent-lifecycle-v2-"));
  report.temporary = temporary;
  for (const name of ["logs", "tmp", "home", "consumer/harness"]) mkdirSync(join(temporary, name), { recursive: true });
  copyRegular(proof.routes.packagedRoute, join(temporary, "product"), assembly.candidateFiles);
  const engineBytes = before.engine.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  copyRegular(join(prepared, "engine"), join(temporary, "engine"), engineBytes);
  const installed = copyRegular(pins.publicPackageReadOnlyRoot, join(temporary, "consumer/node_modules/virtual-bash"));
  assert.equal(installed.length, 709); assert.equal(sha(JSON.stringify(installed)), pins.staticReadEquality.installedPackageInventorySha256);
  for (const entry of installed) assert.deepEqual(entry, assembly.candidateFiles.find(candidate => candidate.path === entry.path));
  for (const tool of assembly.tooling) copyRegular(join(prepared, "node_modules", tool.name), join(temporary, "node_modules", tool.name), tool.files);
  assert.equal(record(join(prepared, "loader.mjs")).sha256, pins.loader.sha256);
  writeFileSync(join(temporary, "loader.mjs"), readFileSync(join(prepared, "loader.mjs")), { flag: "wx", mode: 0o400 });
  for (const filename of ["child.mjs", "guard.mjs", "common.mjs"]) writeFileSync(join(temporary, "consumer/harness", filename), readFileSync(join(directory, filename)), { flag: "wx", mode: 0o400 });
  writeFileSync(join(temporary, "consumer/harness/CASES.json"), readFileSync(join(directory, "CASES.json")), { flag: "wx", mode: 0o400 });
  writeFileSync(join(temporary, "consumer/harness/REVISION.json"), readFileSync(join(directory, "REVISION.json")), { flag: "wx", mode: 0o400 });
  copyRegular(join(lifecycle, "guests"), join(temporary, "consumer/harness/guests"));
  environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(temporary, "home"), TMPDIR: join(temporary, "tmp"), TMP: join(temporary, "tmp"), TEMP: join(temporary, "tmp"),
    XDG_CACHE_HOME: join(temporary, "tmp"), TSX_DISABLE_CACHE: "1", TSX_CACHE_DIR: join(temporary, "tmp"), GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C", TZ: "UTC", SURFACE_ROOT: temporary };
  report.environment = environment;
  immutable = currentImmutable();
  independentShapes = independentDirectoryShape([...Object.keys(immutable).map(name => join(temporary, name)), ...sharedRoots]);
  save("independent-directory-before.json", independentShapes);
  save("immutable-before.json", immutable);
  save("runner-freeze.json", runnerFreeze);
  save("original-freeze.json", load(join(lifecycle, "FREEZE.json")));
  verifyCopies("before-first-guest");
  const deadline = Date.now() + cases.containment.wholeCohortDeadlineMs;
  let blocked;
  for (const row of cases.rows) {
    if (!blocked && row.requiresPositive && report.rows.find(entry => entry.id === row.requiresPositive)?.classification !== "PASS") blocked = `Missing frozen positive ${row.requiresPositive}`;
    if (!blocked && deadline - Date.now() < cases.containment.supervisorDeadlineMs) blocked = "Whole cohort deadline leaves no full child window";
    if (blocked) { report.rows.push({ id: row.id, variantId: variantId(row), classification: "BLOCKED", engineRuns: 0, reason: blocked }); continue; }
    verifyCopies(`before:${row.id}`);
    const result = await launch(row, deadline);
    report.rows.push(result);
    console.log(JSON.stringify(result));
    verifyCopies(`after:${row.id}`);
    if (result.classification !== "PASS") blocked = `First revised-cohort non-pass in ${variantId(row)}; no later child or retry authorized`;
    if (result.containment) blocked = `Failure containment in ${row.id}; remaining rows not launched`;
    if (row.id === "L01-aliases" && result.classification !== "PASS") blocked = "General supported-effect positive L01 did not pass";
  }
  const loaded = new Map();
  for (const filename of readdirSync(output).filter(name => name.endsWith(".imports.ndjson"))) {
    for (const line of readFileSync(join(output, filename), "utf8").trim().split("\n").filter(Boolean)) {
      const entry = JSON.parse(line);
      const absolute = join(temporary, entry.path);
      assert.ok(absolute.startsWith(temporary + "/")); assert.equal(record(absolute).sha256, entry.sha256);
      loaded.set(entry.path, entry.sha256); report.imports.push({ report: filename, ...entry });
    }
  }
  report.loadedFiles = [...loaded].map(([path, sha256]) => ({ path, sha256 }));
  report.loadedEngineFiles = report.loadedFiles.filter(entry => entry.path.startsWith("engine/"));
  report.status = report.rows.every(entry => entry.classification === "PASS") ? "PASS" : "BOUNDED_NONPASS";
} catch (error) {
  report.failure = serialize(error);
  report.status = "BLOCKED_INPUT_OR_HARNESS";
} finally {
  if (activeChild) {
    const child = activeChild; child.kill("SIGKILL");
    await new Promise(resolve => child.once("close", resolve)); activeChild = undefined;
    report.finalContainment = true; report.status = "FAIL";
  }
  try {
    const after = privateState(); save("private-after.json", after);
    report.privateUnchanged = before !== undefined && JSON.stringify(after) === JSON.stringify(before);
    if (before) assert.deepEqual(after, before);
  } catch (error) { report.privateAfterFailure = serialize(error); report.status = "BLOCKED_INPUT_OR_HARNESS"; }
  try {
    report.originalAfter = verifyOriginal();
    report.profileAfter = verifyProfile();
    report.runnerAfterCommit = verifyRunner();
    if (immutable) {
      const shapesAfter = independentDirectoryShape([...Object.keys(immutable).map(name => join(temporary, name)), ...sharedRoots]);
      save("independent-directory-after.json", shapesAfter); assert.deepEqual(shapesAfter, independentShapes);
      verifyCopies("after-execution"); save("immutable-after.json", currentImmutable()); }
    if (sharedBefore) {
      const sharedAfter = Object.fromEntries(sharedRoots.map(root => [root, inventory(root, new Set(), true)]));
      save("shared-after.json", sharedAfter); assert.deepEqual(sharedAfter, sharedBefore); report.sharedUnchanged = true;
    }
    report.publicAfter = { ...state(repository), source: inventory(join(repository, "src")) };
    report.liveInventoryIsNotProductIdentity = true;
  } catch (error) { report.afterGuardFailure = serialize(error); report.status = "BLOCKED_INPUT_OR_HARNESS"; }
  for (const row of cases.rows) if (!report.rows.some(entry => entry.id === row.id)) report.rows.push({ id: row.id, variantId: variantId(row), classification: "BLOCKED", engineRuns: 0, reason: "Earlier input/harness failure; no guest launched" });
  report.counts = { total: 11, logicalWorkflows: 6, executed: report.rows.reduce((total, entry) => total + entry.engineRuns, 0),
    valid: report.rows.filter(entry => entry.engineRuns === 1 && ["PASS", "FAIL"].includes(entry.classification)).length,
    pass: report.rows.filter(entry => entry.classification === "PASS").length, failed: report.rows.filter(entry => entry.classification === "FAIL").length,
    invalid: report.rows.filter(entry => entry.classification === "INVALID_FIXTURE").length, unproved: report.rows.filter(entry => entry.classification === "UNPROVED").length,
    blocked: report.rows.filter(entry => entry.classification === "BLOCKED").length };
  report.finished = new Date().toISOString();
  report.cleanup = { knownCaseChildrenClosed: !activeChild && report.children.every(entry => entry.closed), temporary, removed: false,
    sharedCopiesRemoved: false, appendGuard: "Full immutable regular-file set, bytes and mode/mtime/ctime re-enumerated; new regular files and symlinks detected. Empty-directory additions are not covered." };
  save("report-before-removal.json", report);
  if (temporary) { rmSync(temporary, { recursive: true, force: false }); report.cleanup.removed = !existsSync(temporary); }
  save("report.json", report);
}
console.log(JSON.stringify({ status: report.status, counts: report.counts, privateUnchanged: report.privateUnchanged, sharedUnchanged: report.sharedUnchanged, cleanup: report.cleanup }));
process.exitCode = report.status === "PASS" && report.privateUnchanged && report.cleanup.removed ? 0 : 1;
