import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = "/private/tmp/safe-bash-independent-v2-inputs-5dho_5db/surface/execution-v2";
const surface = dirname(owned);
const repository = "/Users/kjopek/Workspace/safe-bash";
const privateRoot = "/Users/kjopek/Workspace/poe-code";
const environment = { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (root, ...args) => execFileSync("/usr/bin/git", ["-C", root, "-c", "core.fsmonitor=false", ...args], {
  env: environment, encoding: "utf8", timeout: 20000, maxBuffer: 32 * 1024 * 1024,
});
const gitBytes = (commit, filename) => execFileSync("/usr/bin/git", ["show", `${commit}:${filename}`], {
  cwd: repository, env: environment, timeout: 20000, maxBuffer: 32 * 1024 * 1024,
});

function regular(filename) {
  assert.equal(realpathSync(filename), filename, `Symlink component: ${filename}`);
  const stat = lstatSync(filename);
  assert.ok(stat.isFile(), `Not regular: ${filename}`);
  return readFileSync(filename);
}

function fileState(filename) {
  const bytes = regular(filename);
  const stat = lstatSync(filename);
  return { bytes: bytes.length, sha256: hash(bytes), mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function inventory(root, exclusions = new Set()) {
  assert.equal(realpathSync(root), root);
  const entries = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (exclusions.has(name)) continue;
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      assert.ok(!stat.isSymbolicLink(), `Symlink entry: ${filename}`);
      if (stat.isDirectory()) visit(filename);
      else entries.push({ path: relative(root, filename), ...fileState(filename) });
    }
  }
  visit(root);
  return entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function bytesOnly(entries) {
  return entries.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
}

function privateSnapshot() {
  const index = resolve(privateRoot, git(privateRoot, "rev-parse", "--git-path", "index").trim());
  const exclusions = [".git", "node_modules", "dist", ".cache", ".turbo"];
  return {
    at: new Date().toISOString(), head: git(privateRoot, "rev-parse", "HEAD").trim(),
    tree: git(privateRoot, "rev-parse", "HEAD^{tree}").trim(),
    status: git(privateRoot, "status", "--porcelain=v1"), staged: git(privateRoot, "diff", "--cached", "--name-status"),
    index: fileState(index), metadata: Object.fromEntries(["AGENTS.md", ".gitignore", "package.json", "package-lock.json", "tsconfig.json", "packages/poe-agent/package.json"].map(name => [name, fileState(join(privateRoot, name))])),
    engine: inventory(join(privateRoot, "packages/safejs"), new Set(exclusions)),
    qualification: { exclusions, newEligibleEntriesDetected: true, excludedSubtreesAppendProof: false, optionalLocks: "0", fsmonitor: "disabled per read-only command, no config write" },
  };
}

function comparablePrivate(snapshot) {
  const { at, ...state } = snapshot;
  return state;
}

const task = mkdtempSync("/private/tmp/safe-bash-independent-surface-v2-");
const results = join(task, "results");
mkdirSync(results);
const journal = { task, started: new Date().toISOString(), status: "PREPARING", children: [], cases: [], copyProvenance: [], failures: [], release: null };
const put = (filename, value) => {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
};
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

let before;
let inputBaseline;
let sharedBaseline;
let inputRoots;
let sharedRoots;
let pins;
let cohort;
let candidateEntries;
let consumerEntries;
const liveChildren = new Set();
const parentAlive = () => ({ pid: process.pid, at: new Date().toISOString(), alive: true, knownLiveChildren: [...liveChildren] });

function copyTree(source, destination, expected, exclusions = new Set()) {
  const actual = inventory(source, exclusions);
  assert.deepEqual(bytesOnly(actual), expected, `Source inventory ${source}`);
  mkdirSync(destination, { recursive: true });
  for (const entry of actual) {
    const origin = join(source, entry.path);
    const target = join(destination, entry.path);
    put(target, regular(origin));
    chmodSync(target, 0o444);
  }
  assert.deepEqual(bytesOnly(inventory(destination)), expected);
  journal.copyProvenance.push({ source, destination: relative(task, destination), entries: expected });
}

function allInputs(roots) {
  return Object.fromEntries(roots.map(root => [root, inventory(root)]));
}

function assess(selected, actual, child, imports) {
  const checks = [];
  const check = (name, observed, expected) => {
    try { assert.deepEqual(observed, expected); checks.push({ name, pass: true }); }
    catch { checks.push({ name, pass: false, observed, expected }); }
  };
  if (!actual || child.timedOut || child.code !== 0 || child.signal || imports.failures.length) return { id: selected.id, outcome: "BLOCKED", reason: "Child/infrastructure/import guard", checks, child, imports };
  if (selected.conditional) return { id: selected.id, outcome: "AUTHORITY_OBSERVATION_NOT_PASS", actualEngine: actual.engine,
    actualShell: actual.shell, cleanupFailures: actual.cleanupFailures, hostPremise: actual.premise, imports };
  check("runtimeCalls", actual.runtimeCalls, 1);
  check("real metadata premise", actual.premise?.actualMetadata, true);
  check("real public pipe signal identity", actual.premise?.metadataSignalSameAsPublicPipe, true);
  check("host callback counters", actual.hostCounters, selected.expected.hostCounters);
  check("host failure absent", actual.failure, undefined);
  check("cleanup failures", actual.cleanupFailures, []);
  check("unconditional no host capability identities", actual.hostFindings, []);
  check("shell rejection", actual.shell?.rejected, selected.expected.rejected);
  check("exit code", actual.shell?.exitCode, selected.expected.exitCode);
  check("stdout", actual.shell?.stdout, selected.expected.stdout);
  check("stderr", actual.shell?.stderr, selected.expected.stderr);
  check("collected accounted output", actual.collectedStdout, selected.expected.stdout);
  if (selected.id === "08-function-spread-profile") {
    const events = actual.events ?? [];
    const eventCounts = Object.fromEntries(Object.keys(selected.expected.engine.rejection.eventCounts).map(name => [name, events.filter(event => event === name).length]));
    check("observed engine rejection", { outcome: actual.engineOutcome, eventCounts }, selected.expected.engine.rejection);
    const rejectionIndex = events.indexOf("actual-engine-run-rejected");
    check("absent result and rejection ordering", {
      engineOwnField: Object.hasOwn(actual, "engine"),
      rejectionBeforeOperationCloseAndPublicSettlement: rejectionIndex >= 0 && ["operation-close-settled", "shell-exec-settled"].every(name => events.indexOf(name) > rejectionIndex),
    }, selected.expected.engine.resultAndOrder);
  } else {
    check("engine ok", actual.engine?.ok, selected.expected.engine.ok);
    if (Object.hasOwn(selected.expected.engine, "returnValue")) check("exact return", actual.engine?.returnValue, selected.expected.engine.returnValue);
    if (selected.expected.engine.errorMessage) check("exact error", actual.engine?.error?.message, selected.expected.engine.errorMessage);
  }
  if (selected.expected.shapeRows) {
    const value = actual.engine?.returnValue;
    check("return field names", value && Object.keys(value).sort(), [...Object.keys(selected.expected.shapeRows), ...Object.keys(selected.expected.otherReturnFields)].sort());
    for (const [name, shape] of Object.entries(selected.expected.shapeRows)) check(`shape ${name}`, value?.[name], cohort.expectedShapes[shape]);
    for (const [name, expected] of Object.entries(selected.expected.otherReturnFields)) check(`return ${name}`, value?.[name], expected);
  }
  const vfsExpected = [...(actual.vfsBefore ?? [])];
  if (selected.expected.vfsEffect !== "unchanged") {
    const bytes = Buffer.from(selected.expected.vfsEffect.utf8);
    vfsExpected.push({ path: selected.expected.vfsEffect.createFile, type: "file", bytes: bytes.length, base64: bytes.toString("base64"), sha256: hash(bytes) });
    vfsExpected.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  }
  check("VFS bytes and complete namespace", actual.vfsAfter, vfsExpected);
  const failed = checks.filter(entry => !entry.pass);
  let outcome = failed.length ? "FAIL" : "PASS";
  if (actual.runtimeCalls === 0 || actual.failure) outcome = "BLOCKED";
  else if (actual.engine?.error?.name === "ParseError") outcome = "INVALID";
  else if (actual.shell?.exitCode === 124) outcome = "BLOCKED";
  return { id: selected.id, outcome, category: selected.id.startsWith("07-") || selected.id.startsWith("08-") ? "DIALECT_PROFILE_NOT_MEMBRANE_ACCEPTANCE" : "SUPPORTED_SURFACE", checks, failures: failed.length, imports };
}

function auditImports(filename, expected) {
  const entries = existsSync(filename) ? regular(filename).toString().trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const failures = [];
  for (const entry of entries) {
    const approved = entry.path === "consumer/child.mjs" || entry.path.startsWith("consumer/node_modules/virtual-bash/dist/")
      || entry.path.startsWith("engine/src/") || entry.path.startsWith("node_modules/typescript/");
    if (!approved || expected.get(entry.path) !== entry.sha256) failures.push(entry);
  }
  for (const required of pins.privateEngine.sourceEntries) {
    if (!entries.some(entry => entry.path === `engine/${required}`)) failures.push({ missing: `engine/${required}` });
  }
  if (!entries.some(entry => entry.path === "consumer/node_modules/virtual-bash/dist/index.js")) failures.push({ missing: "public root export" });
  return { entries: entries.length, engineSourceFiles: entries.filter(entry => entry.kind === "actual-engine-source-copy").length,
    productFiles: entries.filter(entry => entry.kind === "packed-public-product").length, failures };
}

async function childCase(selected, absoluteDeadline, expectedImports) {
  const caseDirectory = join(results, selected.id);
  mkdirSync(caseDirectory);
  const resultFile = join(caseDirectory, "actual.json");
  const importFile = join(caseDirectory, "imports.ndjson");
  const started = Date.now();
  const deadline = Math.min(started + 10000, absoluteDeadline);
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, ["--import", join(task, "loader.mjs"), join(task, "consumer/child.mjs")], {
    cwd: join(task, "consumer"), env: { PATH: "/usr/bin:/bin", LC_ALL: "C", SURFACE_ROOT: task, SURFACE_IMPORTS: importFile,
      SURFACE_CASE: selected.id, SURFACE_RESULT: resultFile }, stdio: ["ignore", "pipe", "pipe"],
  });
  const entry = { id: selected.id, pid: child.pid, started, deadline, timedOut: false, outputExceeded: false };
  journal.children.push(entry);
  if (child.pid) liveChildren.add(child.pid);
  let bytes = 0;
  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on("data", data => {
    bytes += data.length;
    if (bytes <= 131072) chunks.push(Buffer.from(data));
    else { entry.outputExceeded = true; child.kill("SIGKILL"); }
  });
  const timer = setTimeout(() => { entry.timedOut = true; child.kill("SIGKILL"); }, Math.max(1, deadline - Date.now()));
  await new Promise(resolveChild => {
    child.on("error", error => { entry.error = String(error); });
    child.on("close", (code, signal) => { clearTimeout(timer); entry.code = code; entry.signal = signal; entry.closed = Date.now(); liveChildren.delete(child.pid); resolveChild(); });
  });
  entry.parentAfter = parentAlive();
  put(join(caseDirectory, "stdout.log"), Buffer.concat(stdout));
  put(join(caseDirectory, "stderr.log"), Buffer.concat(stderr));
  put(join(caseDirectory, "child.json"), entry);
  const actual = existsSync(resultFile) ? JSON.parse(regular(resultFile)) : null;
  const imports = auditImports(importFile, expectedImports);
  const assessment = assess(selected, actual, entry, imports);
  put(join(caseDirectory, "assessment.json"), assessment);
  console.log(JSON.stringify({ id: selected.id, outcome: assessment.outcome, exit: actual?.shell?.exitCode, runtimeCalls: actual?.runtimeCalls, failures: assessment.failures, timedOut: entry.timedOut }));
  journal.cases.push({ ...assessment, conditional: selected.conditional });
  return actual;
}

try {
  assert.equal(process.cwd(), repository);
  assert.equal(process.env.NODE_OPTIONS ?? "", "");
  const release = JSON.parse(regular(join(owned, "RELEASE.json")));
  journal.release = release;
  const frozenRunner = JSON.parse(regular(join(owned, "RUNNER-FREEZE.json")));
  for (const entry of frozenRunner.files) assert.equal(hash(regular(join(owned, entry.path))), entry.sha256, entry.path);
  const runnerCommit = "09ba85cef42898fbc2185d03acc4191f9a4689cd";
  assert.ok(runnerCommit, "Runner must be committed before execution");
  for (const entry of [...frozenRunner.files, { path: "RUNNER-FREEZE.json", sha256: hash(regular(join(owned, "RUNNER-FREEZE.json"))) }]) {
    assert.equal(hash(gitBytes(runnerCommit, `tests/integration/safejs-owned-output-prototype-review/surface/execution-v2/${entry.path}`)), entry.sha256);
  }
  journal.runnerCommit = runnerCommit;
  for (const entry of release.receipts) {
    const bytes = gitBytes(entry.commit, entry.path);
    assert.equal(hash(bytes), entry.sha256);
    assert.deepEqual(regular(join(repository, entry.path)), bytes);
  }
  const freeze = JSON.parse(regular(join(surface, "FREEZE-v2.json")));
  assert.deepEqual(regular(join(surface, "FREEZE-v2.json")), gitBytes(release.inputCommit, "tests/integration/safejs-owned-output-prototype-review/surface/FREEZE-v2.json"));
  for (const entry of freeze.files) assert.equal(hash(regular(join(surface, entry.path))), entry.sha256, entry.path);
  pins = JSON.parse(regular(join(owned, "PINS.json")));
  cohort = JSON.parse(regular(join(owned, "CASES.json")));
  assert.equal(process.execPath, pins.tooling.node.path);
  assert.equal(process.version, "v22.22.2");
  assert.equal(hash(regular(process.execPath)), pins.tooling.node.sha256);
  const provenance = new Map();
  for (const entry of pins.provenance.files) {
    const bytes = gitBytes(pins.provenance.commit, entry.path);
    assert.equal(hash(bytes), entry.sha256);
    provenance.set(entry.name, JSON.parse(bytes));
  }
  candidateEntries = provenance.get("assembly.json").candidateFiles;
  consumerEntries = provenance.get("build-proof.json").consumerFiles;
  assert.equal(hash(gitBytes(pins.candidate.evidenceCommit, pins.candidate.archive.path)), pins.candidate.archive.sha256);
  before = privateSnapshot();
  put(join(results, "private-before.json"), before);
  assert.equal(before.head, pins.privateEngine.lastRecordedHead);
  assert.equal(before.engine.length, 264);
  const previous = provenance.get("snapshot-after.json").private.engine;
  assert.deepEqual(bytesOnly(before.engine), Object.entries(previous).map(([path, value]) => ({ path, bytes: value.bytes, sha256: value.sha256 })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  put(join(results, "public-before.json"), { at: new Date().toISOString(), head: git(repository, "rev-parse", "HEAD").trim(), status: git(repository, "status", "--porcelain=v1"), staged: git(repository, "diff", "--cached", "--name-status"), source: inventory(join(repository, "src")), qualification: "Recorded separately; never overlaid or compared for acceptance with prototype" });
  const shared = pins.preparedRoot;
  sharedRoots = [join(shared, "candidate"), join(shared, "consumer/node_modules/virtual-bash"), join(shared, "engine"), join(shared, "node_modules"),
    "/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/source-route", "/private/tmp/safe-bash-owned-output-receipt-review-zqBitE/packaged-route"];
  sharedBaseline = allInputs(sharedRoots);
  for (const root of sharedRoots.slice(-2)) assert.deepEqual(bytesOnly(sharedBaseline[root]), candidateEntries);
  assert.deepEqual(bytesOnly(inventory(join(shared, "engine"))), bytesOnly(before.engine));
  copyTree(join(shared, "candidate"), join(task, "candidate"), candidateEntries);
  copyTree(join(shared, "consumer/node_modules/virtual-bash"), join(task, "consumer/node_modules/virtual-bash"), consumerEntries);
  copyTree(join(shared, "engine"), join(task, "engine"), bytesOnly(before.engine));
  for (const tool of provenance.get("assembly.json").tooling) copyTree(join(shared, "node_modules", tool.name), join(task, "node_modules", tool.name), tool.files);
  const loader = regular(join(shared, "loader.mjs"));
  assert.equal(hash(loader), pins.tooling.loader.sha256);
  put(join(task, "loader.mjs"), loader);
  put(join(task, "consumer/child.mjs"), regular(join(owned, "child.mjs")));
  for (const filename of ["CASES.json", "PINS.json", ...cohort.cases.map(entry => entry.source.path)]) put(join(task, "inputs", filename), regular(join(filename === "CASES.json" || filename === "PINS.json" ? owned : surface, filename)));
  inputRoots = [join(task, "candidate"), join(task, "consumer"), join(task, "engine"), join(task, "node_modules"), join(task, "inputs")];
  inputBaseline = allInputs(inputRoots);
  independentShapes = independentDirectoryShape([...inputRoots, ...sharedRoots]);
  put(join(results, "independent-directory-before.json"), independentShapes);
  put(join(results, "copy-provenance.json"), journal.copyProvenance);
  put(join(results, "inputs-before.json"), inputBaseline);
  const expectedImports = new Map();
  for (const [root, entries] of Object.entries(inputBaseline)) for (const entry of entries) expectedImports.set(relative(task, join(root, entry.path)), entry.sha256);
  put(join(results, "import-allowlist.json"), Object.fromEntries(expectedImports));
  journal.status = "EXECUTING";
  journal.cohortDeadline = Date.now() + 100000;
  for (const selected of cohort.cases.filter(entry => !entry.conditional)) {
    if (Date.now() >= journal.cohortDeadline) { journal.failures.push("Cohort absolute deadline reached"); break; }
    const actual = await childCase(selected, journal.cohortDeadline, expectedImports);
    const identityFindings = actual?.hostFindings ?? [];
    const fieldFindings = Object.entries(actual?.engine?.returnValue ?? {}).flatMap(([row, value]) => {
      if (!value || !Array.isArray(value.types)) return [];
      return value.types.filter(([field, type]) => ["ownedOutput", "consumerClosed", "acquire", "child", "close", "registerCleanup", "output", "signal", "context"].includes(field) && type !== "undefined").map(([field, type]) => ({ row, field, type }));
    });
    if (identityFindings.length || fieldFindings.length || actual?.engine?.returnValue?.exposurePath) {
      const finding = { at: new Date().toISOString(), id: selected.id, runnerCommit, source: actual.source, runtimeIdentity: actual.runtimeIdentity, hostPremise: actual.premise, identityFindings, fieldFindings, returned: actual.engine?.returnValue, action: "STOP: finite facts only; no unplanned callback" };
      put(join(results, "finding.json"), finding);
      put(join(results, "independent-finding.txt"), JSON.stringify(finding, null, 2) + "\n");
      console.log("ROOT FINDING " + JSON.stringify(finding));
      journal.finding = finding;
      const exactHost = identityFindings.some(entry => entry.path === "stdio.write.registerCleanup"
        && entry.type === "function" && entry.identity.some(name => ["contextRegisterCleanup", "operationRegisterCleanup"].includes(name)));
      const exactGuest = fieldFindings.some(entry => entry.row === "write" && entry.field === "registerCleanup" && entry.type === "function")
        || actual.engine?.returnValue?.exposurePath === "stdio.write.registerCleanup" && actual.engine?.returnValue?.type === "function";
      if (exactHost && exactGuest) {
        journal.conditionalPremise = { exactHost, exactGuest, findingPublishedBeforeEffect: true };
        journal.conditionalExecutionRefused = "Independent release authorizes only eight unconditional rows; no extra guest";
      }
      break;
    }
  }
  journal.status = "EXECUTION_SETTLED";
} catch (error) {
  journal.status = "INFRASTRUCTURE_FAILURE";
  journal.failures.push({ message: String(error), stack: error.stack });
  console.error(String(error));
} finally {
  try {
    const after = privateSnapshot();
    put(join(results, "private-after.json"), after);
    journal.privateUnchanged = before ? JSON.stringify(comparablePrivate(after)) === JSON.stringify(comparablePrivate(before)) : null;
    if (before) assert.deepEqual(comparablePrivate(after), comparablePrivate(before), "Private state changed; never restore it");
  } catch (error) { journal.failures.push({ phase: "private-after", error: String(error) }); }
  try {
    if (inputBaseline) {
      const shapesAfter = independentDirectoryShape([...inputRoots, ...sharedRoots]);
      put(join(results, "independent-directory-after.json"), shapesAfter);
      assert.deepEqual(shapesAfter, independentShapes);
      const after = allInputs(inputRoots);
      put(join(results, "inputs-after.json"), after);
      assert.deepEqual(after, inputBaseline, "Owned input bytes/metadata/new entries changed");
      assert.equal(hash(regular(join(task, "loader.mjs"))), pins.tooling.loader.sha256);
      journal.inputTreesUnchanged = true;
    }
    if (sharedBaseline) {
      const after = allInputs(sharedRoots);
      assert.deepEqual(after, sharedBaseline, "Shared prepared trees changed");
      journal.sharedTreesUnchanged = true;
      put(join(results, "shared-guard.json"), { before: Object.fromEntries(Object.entries(sharedBaseline).map(([root, entries]) => [root, { files: entries.length, sha256: hash(JSON.stringify(entries)) }])), after: Object.fromEntries(Object.entries(after).map(([root, entries]) => [root, { files: entries.length, sha256: hash(JSON.stringify(entries)) }])), newEntriesDetected: true });
    }
  } catch (error) { journal.failures.push({ phase: "input-after", error: String(error) }); }
  journal.parentAfter = parentAlive();
  journal.completed = new Date().toISOString();
  const unconditional = journal.cases.filter(entry => !entry.conditional);
  journal.counts = { executed: unconditional.length, pass: unconditional.filter(entry => entry.outcome === "PASS").length,
    fail: unconditional.filter(entry => entry.outcome === "FAIL").length, invalid: unconditional.filter(entry => entry.outcome === "INVALID").length,
    blocked: 8 - unconditional.length + unconditional.filter(entry => entry.outcome === "BLOCKED").length,
    conditionalExecuted: journal.cases.filter(entry => entry.conditional).length };
  put(join(results, "journal.json"), journal);
  console.log(JSON.stringify({ task, status: journal.status, counts: journal.counts, privateUnchanged: journal.privateUnchanged, inputsUnchanged: journal.inputTreesUnchanged, sharedUnchanged: journal.sharedTreesUnchanged, failures: journal.failures, parent: journal.parentAfter }));
}
