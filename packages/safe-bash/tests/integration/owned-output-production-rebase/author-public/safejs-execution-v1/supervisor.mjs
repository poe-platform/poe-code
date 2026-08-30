import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { authenticateImport, copyTree, directory, git, inventory, json, owner, regular, sha256, verifyAuthor, verifyTooling, writeJson, writeNew } from "../harness/common.mjs";
import { frozenAuthor, frozenJson, makeCurrentImportBinding, referenceBytes } from "../harness/safejs-binding.mjs";
import { executionFreeze, hashFile, snapshot } from "../execution-v1/archive-binding.mjs";
import { copyActualEngine, privateSnapshot, verifyPrivatePrecondition } from "./private-guard.mjs";
import { createSurfaceAssessor } from "./surface-assessment.mjs";

const current = dirname(fileURLToPath(import.meta.url));
export function verifySafeJsFreeze() {
  const path = `${owner}/safejs-execution-v1/EXECUTION-INPUTS.json`;
  const commit = git("log", "-1", "--format=%H", "--", path).toString().trim();
  assert.match(commit, /^[a-f0-9]{40}$/u);
  const bytes = git("show", `${commit}:${path}`);
  assert.deepEqual(regular(join(current, "EXECUTION-INPUTS.json")), bytes);
  const freeze = JSON.parse(bytes);
  for (const entry of freeze.files) {
    const actual = regular(join(current, entry.path));
    assert.equal(sha256(actual), entry.sha256, entry.path);
    assert.deepEqual(actual, git("show", `${commit}:${owner}/safejs-execution-v1/${entry.path}`));
  }
  return { commit, manifestSha256: sha256(bytes) };
}
function publicGuards(binding) {
  const release = json(join(directory, "execution-v1/ROOT-RELEASE.json"));
  assert.equal(release.allowPrivateCohorts, true);
  assert.equal(release.candidateCommit, binding.candidateCommit);
  verifyAuthor(release.authorCommit);
  executionFreeze();
  verifyTooling();
  assert.equal(hashFile(binding.nodePath), binding.nodeSha256);
  assert.equal(hashFile(binding.tarballPath), binding.tarballSha256);
  assert.equal(hashFile(binding.archivePath), binding.archiveSha256);
  assert.equal(hashFile(binding.parentInventoryPath), binding.parentInventorySha256);
  const candidate = json(join(directory, "execution-v1/CANDIDATE.json"));
  assert.equal(candidate.sourceManifestSha256, binding.sourceManifestSha256);
  assert.deepEqual(snapshot(binding.productRoot, binding.productRoot, candidate.nativeFixtureSymlinks), json(binding.parentInventoryPath));
  assert.deepEqual(inventory(binding.packageRoot), binding.packageEntries);
  return { candidateCommit: candidate.commit, candidateTree: candidate.tree, sourceManifestSha256: candidate.sourceManifestSha256, wholeCommittedInputTreeUnchanged: true, newEntriesChecked: true, tarballSha256: binding.tarballSha256, packageManifestSha256: sha256(JSON.stringify(binding.packageEntries)) };
}
function auditImports(filename, binding) {
  const entries = existsSync(filename) ? regular(filename).toString().trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const failures = [];
  for (const entry of entries) {
    const expected = binding.files.find(candidate => candidate.path === entry.path);
    if (!expected || expected.sha256 !== entry.sha256 || entry.candidateCommit !== binding.candidateCommit) failures.push(entry);
  }
  const engine = [...new Set(entries.filter(entry => entry.kind === "actual-engine-source-copy").map(entry => entry.path))].sort();
  if (JSON.stringify(engine) !== JSON.stringify([...binding.allowedEnginePaths].sort())) failures.push({ error: "Actual private import closure differs from the exact approved 63 entries", engine });
  for (const hook of binding.requiredEngineHooks) if (!engine.includes(`engine/${hook}`)) failures.push({ missing: hook });
  if (!entries.some(entry => entry.path === "consumer/node_modules/virtual-bash/dist/index.js")) failures.push({ missing: "current public root" });
  return { entries: entries.length, engineSourceFiles: engine.length, productFiles: entries.filter(entry => entry.kind === "packed-public-product").length, failures, raw: entries };
}
async function childRun({ row, family, root, node, environment, cases, deadline, binding, report }) {
  const surface = family === "surface";
  const log = join(root, "logs", row.id);
  mkdirSync(log);
  const resultFile = surface ? join(log, "actual.json") : join(root, "logs", `${row.id}.json`);
  const importsFile = surface ? join(log, "imports.ndjson") : join(root, "logs", `${row.id}.imports.ndjson`);
  const args = surface
    ? ["--import", join(root, "loader.mjs"), join(root, "consumer/child.mjs")]
    : ["--max-old-space-size=256", "--unhandled-rejections=strict", "--import", pathToFileURL(join(root, "consumer/harness/guard.mjs")).href, "--import", pathToFileURL(join(root, "loader.mjs")).href, join(root, "consumer/harness/child.mjs")];
  const child = spawn(node, args, { cwd: join(root, "consumer"), env: { ...environment, SURFACE_CASE: row.id, LIFECYCLE_ROW: row.id, SURFACE_IMPORTS: importsFile, SURFACE_RESULT: resultFile }, stdio: ["ignore", "pipe", "pipe"] });
  report.knownChildren.push({ id: row.id, pid: child.pid, closed: false });
  const childRecord = report.knownChildren.at(-1);
  const output = { stdout: [], stderr: [] };
  let outputBytes = 0;
  let containment;
  let spawnError;
  const contain = reason => { if (!containment) { containment = reason; child.kill("SIGKILL"); } };
  const limit = surface ? 131072 : cases.containment.childOutputMaxBytes;
  const timer = setTimeout(() => contain("parent-watchdog"), Math.max(1, Math.min(surface ? 10000 : cases.containment.supervisorDeadlineMs, deadline - Date.now())));
  for (const stream of ["stdout", "stderr"]) child[stream].on("data", bytes => {
    outputBytes += bytes.length;
    if (outputBytes > limit) contain("output-limit");
    else output[stream].push(Buffer.from(bytes));
  });
  child.on("error", error => { spawnError = { name: error.name, message: error.message }; });
  const closed = await new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  Object.assign(childRecord, { closed: true, ...closed, containment: containment ?? null });
  for (const stream of ["stdout", "stderr"]) writeNew(join(log, `${stream}.txt`), Buffer.concat(output[stream]));
  const childReport = { id: row.id, pid: child.pid, args, ...closed, timedOut: containment === "parent-watchdog", containment: containment ?? null, outputBytes, spawnError: spawnError ?? null, naturalExit: !containment && closed.signal === null };
  writeJson(join(log, "child.json"), childReport);
  const actual = existsSync(resultFile) ? json(resultFile) : null;
  const imports = auditImports(importsFile, binding);
  writeJson(join(log, "import-audit.json"), imports);
  let assessed;
  if (surface) assessed = createSurfaceAssessor(cases)(row, actual, childReport, imports);
  else {
    const classification = containment || closed.signal || !actual ? "FAIL" : actual.classification;
    if (classification === "PASS") assert.equal(closed.code, 0);
    assessed = { id: row.id, variantId: actual?.variantId ?? row.id, classification, engineRuns: actual?.engineRuns ?? 0, childExit: closed.code, signal: closed.signal, containment: !!containment || !!actual?.containment, reportPresent: !!actual, fatal: actual?.fatal };
  }
  if (imports.failures.length || spawnError || containment) assessed = { ...assessed, classification: "IMPORT_OR_CHILD_GUARD_NONPASS", outcome: "BLOCKED" };
  writeJson(join(log, "assessment.json"), assessed);
  return { id: row.id, classification: assessed.outcome ?? assessed.classification, engineRuns: surface ? actual?.runtimeCalls ?? 0 : actual?.engineRuns ?? 0, containment: !!containment || !!actual?.containment, importEntries: imports.entries, engineSourceFiles: imports.engineSourceFiles, productFiles: imports.productFiles, resultFile, log, naturalExit: childReport.naturalExit };
}
export async function runCohort(family) {
  assert.ok(["surface", "lifecycle", "controls"].includes(family));
  const frozen = verifySafeJsFreeze();
  const binding = json(join(current, "PUBLIC-BINDING.json"));
  const cases = frozenJson(`${frozenAuthor}/${family}/CASES.json`);
  const rows = family === "surface" ? cases.cases.slice(0, 8) : cases.rows;
  const root = realpathSync(mkdtempSync(`/tmp/safe-bash-author-current-safejs-${family}-`));
  for (const path of ["logs", "tmp", "home", "evidence"]) mkdirSync(join(root, path));
  const evidence = join(root, "evidence");
  const report = { qualification: "AUTHOR_CURRENT_SOURCE_HOOK_INJECTION_NOT_INDEPENDENT_ACCEPTANCE_OR_INSTALLED_PRIVATE_PACKAGE", family, candidateCommit: binding.candidateCommit, candidateTree: binding.candidateTree, sourceManifestSha256: binding.sourceManifestSha256, frozen, root, rows: [], knownChildren: [], status: "STARTED", startedAt: new Date().toISOString(), privateBeforeAttempted: false };
  let before;
  let immutable;
  let map;
  let privatePreconditionPassed = false;
  const copiedRoots = ["engine", "consumer", "node_modules", "inputs", "tools"];
  const immutableState = () => ({ trees: Object.fromEntries(copiedRoots.filter(path => existsSync(join(root, path))).map(path => [path, inventory(join(root, path))])), loader: sha256(regular(join(root, "loader.mjs"))), importMap: sha256(regular(join(root, "CURRENT-IMPORTS.json"))) });
  try {
    report.publicBefore = publicGuards(binding);
    report.privateBeforeAttempted = true;
    before = privateSnapshot();
    writeJson(join(evidence, "private-before.json"), before);
    verifyPrivatePrecondition(before);
    privatePreconditionPassed = true;
    report.privatePrecondition = "EXACT_APPROVED_PROFILE";
    copyActualEngine(before, join(root, "engine"));
    const pending = join(root, "consumer-before-move");
    copyTree(binding.packageRoot, join(pending, "node_modules/virtual-bash"), binding.packageEntries);
    writeNew(join(pending, "package.json"), '{"private":true,"type":"module"}\n');
    if (family === "surface") {
      writeNew(join(pending, "child.mjs"), referenceBytes(`${frozenAuthor}/surface/child.mjs`));
      const pins = frozenJson(`${frozenAuthor}/surface/PINS.json`);
      writeJson(join(root, "inputs/PINS.json"), { schema: 1, privateEngine: pins.privateEngine, api: pins.api, currentCandidate: { commit: binding.candidateCommit, tree: binding.candidateTree, sourceManifestSha256: binding.sourceManifestSha256, packageManifestSha256: sha256(JSON.stringify(binding.packageEntries)) }, historicalPinQualification: "Only unchanged engine and API premise fields retained; no historical product golden" });
      writeNew(join(root, "inputs/CASES.json"), referenceBytes(`${frozenAuthor}/surface/CASES.json`));
      for (const row of rows) writeNew(join(root, "inputs", row.source.path), referenceBytes(`${frozenAuthor}/surface/${row.source.path}`));
    } else {
      for (const path of ["child.mjs", "guard.mjs", "common.mjs", "CASES.json", "REVISION.json", ...new Set(rows.map(row => row.guest))]) writeNew(join(pending, "harness", path), referenceBytes(`${frozenAuthor}/${family}/${path}`));
    }
    renameSync(pending, join(root, "consumer"));
    assert.equal(existsSync(pending), false);
    copyTree(binding.compilerRoot, join(root, "node_modules/typescript"), binding.compilerEntries);
    writeNew(join(root, "tools/bin/node"), regular(binding.nodePath), 0o755);
    writeNew(join(root, "loader.mjs"), regular(join(current, "loader.mjs")));
    const engineEntries = before.engine.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest }));
    map = makeCurrentImportBinding({ candidateCommit: binding.candidateCommit, candidateTree: binding.candidateTree, authorCommit: frozen.commit, root, productEntries: binding.packageEntries, compilerEntries: binding.compilerEntries, engineEntries, driverEntries: family === "surface" ? [] : inventory(join(root, "consumer/harness")) });
    if (family === "surface") map.files.push({ path: "consumer/child.mjs", bytes: regular(join(root, "consumer/child.mjs")).length, sha256: sha256(regular(join(root, "consumer/child.mjs"))), kind: "unchanged-approved-surface-child" });
    map.files.push({ path: "loader.mjs", bytes: regular(join(root, "loader.mjs")).length, sha256: sha256(regular(join(root, "loader.mjs"))), kind: "current-author-loader" });
    map.status = "ROOT_RELEASED_CURRENT_CANDIDATE_EXACT_IMPORT_BINDING";
    writeJson(join(root, "CURRENT-IMPORTS.json"), map);
    writeJson(join(evidence, "current-import-binding.json"), map);
    immutable = immutableState();
    writeJson(join(evidence, "immutable-before.json"), immutable);
    const environment = { PATH: "/usr/bin:/bin", HOME: join(root, "home"), TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"), XDG_CACHE_HOME: join(root, "tmp"), TSX_DISABLE_CACHE: "1", LC_ALL: "C", TZ: "UTC", GIT_OPTIONAL_LOCKS: "0", SURFACE_ROOT: root };
    const deadline = Date.now() + (family === "surface" ? 100000 : cases.containment.wholeCohortDeadlineMs);
    let blocked;
    for (const row of rows) {
      if (blocked) { report.rows.push({ id: row.id, classification: "BLOCKED", engineRuns: 0, reason: blocked }); continue; }
      for (const required of [row.requiresPositive, row.requiresMatchedOpen].filter(Boolean)) if (report.rows.find(prior => prior.id === required)?.classification !== "PASS") blocked = `Missing original positive prerequisite ${required}`;
      if (deadline - Date.now() < (family === "surface" ? 10000 : cases.containment.supervisorDeadlineMs)) blocked = "Whole cohort deadline leaves no complete child window";
      if (blocked) { report.rows.push({ id: row.id, classification: "BLOCKED", engineRuns: 0, reason: blocked }); continue; }
      assert.deepEqual(immutableState(), immutable, "Current copied source/tool/package/driver inputs before child");
      const result = await childRun({ row, family, root, node: join(root, "tools/bin/node"), environment, cases, deadline, binding: map, report });
      report.rows.push(result);
      assert.deepEqual(immutableState(), immutable, "Current copied source/tool/package/driver inputs after child, including additions");
      console.log(JSON.stringify({ family, id: row.id, classification: result.classification, engineRuns: result.engineRuns, source: binding.sourceManifestSha256 }));
      if (result.classification !== "PASS") blocked = `First nonpass ${row.id}; no retry/rescue or later child`;
    }
    report.status = report.rows.every(row => row.classification === "PASS") ? "AUTHOR_COHORT_PASS" : "AUTHOR_COHORT_NONPASS";
  } catch (error) {
    report.status = report.privateBeforeAttempted && !privatePreconditionPassed ? "PRIVATE_PRECONDITION_NONPASS_NO_GUEST" : "AUTHOR_BINDING_OR_RUNTIME_NONPASS";
    report.error = { name: error.name, message: error.message, stack: error.stack };
  } finally {
    if (report.privateBeforeAttempted) {
      try {
        const after = privateSnapshot();
        writeJson(join(evidence, "private-after.json"), after);
        assert.ok(before, "Complete before snapshot required");
        assert.deepEqual(after, before, "Fresh full private before/after equality, including failure paths");
        report.privateBeforeAfter = "EXACTLY_UNCHANGED";
      } catch (error) { report.privateBeforeAfter = { error: error.message }; report.status = "PRIVATE_INTEGRITY_NONPASS"; }
    }
    if (immutable) {
      try { const after = immutableState(); writeJson(join(evidence, "immutable-after.json"), after); assert.deepEqual(after, immutable); report.copiedInputsBeforeAfter = "UNCHANGED_INCLUDING_NEW_ENTRIES"; }
      catch (error) { report.copiedInputsBeforeAfter = { error: error.message }; report.status = "COPIED_INPUT_INTEGRITY_NONPASS"; }
    }
    try { report.publicAfter = publicGuards(binding); verifySafeJsFreeze(); report.publicBeforeAfter = "UNCHANGED_INCLUDING_NEW_ENTRIES"; }
    catch (error) { report.publicBeforeAfter = { error: error.message }; report.status = "PUBLIC_INPUT_INTEGRITY_NONPASS"; }
    for (const row of rows) if (!report.rows.some(result => result.id === row.id)) report.rows.push({ id: row.id, classification: "BLOCKED", engineRuns: 0, reason: "Earlier binding/private prerequisite failure; no guest launched" });
    report.counts = { intended: rows.length, engineRuns: report.rows.reduce((total, row) => total + row.engineRuns, 0), pass: report.rows.filter(row => row.classification === "PASS").length, nonpass: report.rows.filter(row => row.classification !== "PASS" && row.classification !== "BLOCKED").length, blocked: report.rows.filter(row => row.classification === "BLOCKED").length };
    report.knownLiveChildren = report.knownChildren.filter(child => !child.closed);
    report.finishedAt = new Date().toISOString();
    report.limits = "No claim of opaque-handle hard preemption, installed-private-package support, deployed services, full gate, promotion or independent acceptance";
    writeJson(join(evidence, "report.json"), report);
    console.log(JSON.stringify({ family, status: report.status, counts: report.counts, privateBeforeAfter: report.privateBeforeAfter, evidence }));
    if (report.status !== "AUTHOR_COHORT_PASS") process.exitCode = 1;
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.argv.length, 3);
  await runCohort(process.argv[2]);
}
