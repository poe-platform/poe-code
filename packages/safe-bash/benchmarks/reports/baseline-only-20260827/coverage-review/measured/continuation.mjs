import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { root, owned, hash, json, read, evidence, tree, publish, knownFiles, errorRecord } from "./continuation-common.mjs";

assert.equal(process.cwd(), root);
const [attempt, destination, authorCommit, prefix] = process.argv.slice(2);
assert.equal(prefix, `${owned}/replay`);
const recoveryGatePath = "/tmp/safe-bash-baseline-measured-review-recovery-response.txt";
const recoveryGate = read(recoveryGatePath);
assert.ok(recoveryGate.includes("ONE explicit repeat"));
const prefixResults = json(`${prefix}/results.json`);
assert.equal(prefixResults.counts.actualAttempts, 12);
assert.equal(prefixResults.counts.agreement, 12);
assert.ok(prefixResults.parentError);
const prefixKeys = new Set(prefixResults.observations.map(entry => `${entry.engine}/${entry.caseId}`));
assert.equal(prefixKeys.size, 12);
assert.ok(!existsSync(`${prefix}/raw/clear-positive.ours.json`), "Recover exactly published lost capture instead of repeating");
assert.ok(attempt && destination && authorCommit, "Provide closed author attempt, new review output, and full author commit");
assert.ok(destination.startsWith(`${owned}/`) && !destination.includes("..") && !existsSync(destination));
const gatePath = "/tmp/safe-bash-baseline-coverage-review.ready";
const gate = read(gatePath);
assert.ok(gate.includes(authorCommit) || gate.includes(authorCommit.slice(0, 7)), "Gate must identify the closed author commit");
assert.ok(gate.includes(attempt) || gate.includes(path.basename(attempt)), "Gate must release the exact author attempt");
const manifest = json(`${attempt}/manifest.json`);
const inputs = json(`${attempt}/execution-inputs.json`);
const freeze = json(`${attempt}/freeze.json`);
assert.equal(hash(readFileSync(`${attempt}/manifest.json`)), freeze.manifestSha256);
assert.equal(hash(readFileSync(`${attempt}/execution-inputs.json`)), freeze.inputsSha256);
assert.equal(inputs.cases.length, 61);
assert.equal(inputs.diagnostics.length, 7);
assert.equal(inputs.budgets.ordinaryMs, 30000);
assert.equal(inputs.budgets.optionalMs, 120000);
assert.equal(inputs.budgets.childGraceMs, 10000);
assert.equal(inputs.sourceSha256, "30f5cfb47f69af0aeb4460fa901904d0b70f4ca8594013f70aa308dafb379732");
for (const filename of ["manifest.json", "execution-inputs.json", "freeze.json", "results.json"]) {
  const committed = execFileSync("git", ["show", `${authorCommit}:${attempt}/${filename}`], { maxBuffer: 64 * 1024 * 1024 });
  assert.equal(hash(committed), hash(readFileSync(`${attempt}/${filename}`)), `Author committed bytes changed: ${filename}`);
}
const verifier = entry => {
  const current = evidence(entry.path);
  assert.equal(current.sha256, entry.sha256, `Frozen runtime drift: ${entry.path}`);
  return current;
};
function integritySnapshot() {
  const snapshot = tree(`${inputs.paths.snapshot}/src`);
  assert.equal(snapshot.sha256, manifest.snapshot.sha256);
  const dependencies = manifest.dependencies.map(expected => {
    const current = tree(expected.directory);
    assert.equal(current.sha256, expected.sha256, `Dependency drift: ${expected.directory}`);
    return { directory: current.directory, sha256: current.sha256, files: current.entries.length };
  });
  const harness = manifest.harness.map(verifier);
  const assets = manifest.runtimeAssets.map(verifier);
  const snapshotConfig = manifest.snapshotConfiguration.map(verifier);
  assert.equal(inputs.childEnvironment.TSX_TSCONFIG_PATH, `${inputs.paths.snapshot}/tsconfig.json`);
  return { capturedAt: new Date().toISOString(), sourceSha256: snapshot.sha256, dependencies, harness, assets, snapshotConfig, node: verifier(manifest.node.executable) };
}
const before = integritySnapshot();
const reviewerFiles = ["continuation.mjs", "continuation-common.mjs", "common.mjs"].map(name => evidence(`${owned}/${name}`));
const assessmentPath = manifest.harness.find(entry => entry.path.endsWith("/assess.mjs")).path;
const { assess, stable } = await import(pathToFileURL(path.resolve(assessmentPath)));
const known = knownFiles(manifest, inputs);
const requests = [];
let activeCase;
const server = createServer((request, response) => {
  requests.push({ case: activeCase, method: request.method, path: request.url, remoteAddress: request.socket.remoteAddress });
  const allowed = request.method === inputs.network.method && request.url === inputs.network.path;
  const bytes = allowed ? Buffer.from(inputs.network.bodyBase64, "base64") : Buffer.from("denied\n");
  response.writeHead(allowed ? inputs.network.status : 403, { "Content-Type": inputs.network.contentType, "Content-Length": bytes.length, "Connection": "close", "Date": "Thu, 01 Jan 1970 00:00:00 GMT" });
  response.end(bytes);
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(inputs.network.port, inputs.network.host, resolve); });
const captures = [];
let newLaunches = 0;
let publicationFailure = null;
function runChild(specimen, engine) {
  return new Promise(resolve => {
    const args = [...(engine === "ours" ? ["--import", inputs.paths.tsx] : []), inputs.paths.child, path.resolve(attempt, "execution-inputs.json"), engine, specimen.id];
    const authorCapture = json(`${attempt}/raw/${specimen.id}.${engine}.json`);
    assert.deepEqual([inputs.paths.node, ...args], authorCapture.argv, "Replay must use exactly recorded author argv");
    assert.deepEqual(inputs.childEnvironment, authorCapture.childEnvironment);
    newLaunches += 1;
    const child = spawn(inputs.paths.node, args, { cwd: root, env: inputs.childEnvironment, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const started = performance.now();
    const capture = { engine, caseId: specimen.id, pid: child.pid, argv: [inputs.paths.node, ...args], childEnvironment: inputs.childEnvironment, phases: [], parentTimeout: false, report: null };
    const stdout = [];
    const stderr = [];
    let totalBytes = 0;
    let cleanupTimer;
    let killTimer;
    const terminate = reason => {
      if (capture.parentTimeout) return;
      capture.parentTimeout = true;
      capture.terminationReason = reason;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => { capture.forceKilled = true; child.kill("SIGKILL"); }, inputs.budgets.childGraceMs);
    };
    const guard = setTimeout(() => terminate("child total setup + product + cleanup exceeded configured envelope"), specimen.budgetMs + 2 * inputs.budgets.childGraceMs);
    const collect = chunks => chunk => {
      totalBytes += chunk.length;
      chunks.push(chunk);
      if (totalBytes > 16 * 1024 * 1024) terminate("host diagnostic output cap");
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("message", message => {
      if (message.kind === "phase") capture.phases.push({ phase: message.phase, sinceSpawnMs: performance.now() - started });
      if (message.kind === "result") {
        capture.report = message.report;
        clearTimeout(guard);
        cleanupTimer = setTimeout(() => terminate("child retained resources after result; cleanup grace exceeded"), inputs.budgets.childGraceMs);
      }
    });
    child.on("error", error => { capture.launchError = errorRecord(error); });
    child.on("close", (code, signal) => {
      clearTimeout(guard); clearTimeout(cleanupTimer); clearTimeout(killTimer);
      capture.exitCode = code;
      capture.signal = signal;
      capture.totalElapsedMs = performance.now() - started;
      capture.hostStdoutBase64 = Buffer.concat(stdout).toString("base64");
      capture.hostStderrBase64 = Buffer.concat(stderr).toString("base64");
      capture.moduleTrace = [];
      capture.hostDiagnostics = [];
      for (const line of Buffer.concat(stderr).toString("utf8").split("\n").filter(Boolean)) {
        if (line.startsWith("COVERAGE_MODULE ")) {
          try { capture.moduleTrace.push(JSON.parse(line.slice("COVERAGE_MODULE ".length))); }
          catch { capture.hostDiagnostics.push(line); }
        } else capture.hostDiagnostics.push(line);
      }
      capture.loadedFileEvidence = [...new Set([...capture.moduleTrace.filter(entry => entry.url.startsWith("file:")).map(entry => fileURLToPath(entry.url)), ...(capture.report?.commonJsModules ?? [])])].sort().map(filename => {
        try { const current = evidence(filename); return { ...current, frozenSha256: known.get(filename) ?? known.get(current.realpath) ?? null, matchesFreeze: current.sha256 === (known.get(filename) ?? known.get(current.realpath)) }; }
        catch (error) { return { path: filename, error: errorRecord(error) }; }
      });
      capture.assessment = assess(specimen, capture);
      resolve(capture);
    });
  });
}
let parentError = null;
try {
  publish(`${destination}/before.json`, { ...before, gate: { path: gatePath, text: gate, sha256: hash(gate) }, authorCommit, attempt, freeze, reviewerFiles, exactInputsReused: true, productCallsBeforeThisRecord: 0, endpoint: inputs.network, continuation: { recoveryGatePath, recoveryGate, prefix, prefixResultsSha256: hash(readFileSync(`${prefix}/results.json`)), priorLaunches: 13, priorCaptured: 12, priorLostCapture: "clear-positive.ours", explicitRepeatAuthorized: true, plannedNewLaunches: 124, plannedTotalLaunches: 137, originalHarnessArchived: `${prefix}/harness`, reused: prefixResults.observations.map(entry => ({ engine: entry.engine, caseId: entry.caseId, path: entry.raw, sha256: hash(readFileSync(entry.raw)) })) } });
  const orderedCases = [...inputs.cases.filter(specimen => specimen.cohort.startsWith("shared")), ...inputs.cases.filter(specimen => !specimen.cohort.startsWith("shared")), ...inputs.diagnostics];
  for (const specimen of orderedCases) for (const engine of ["ours", "baseline"]) {
    activeCase = { engine, id: specimen.id };
    const reused = prefixKeys.has(`${engine}/${specimen.id}`);
    const capture = reused ? json(`${prefix}/raw/${specimen.id}.${engine}.json`) : await runChild(specimen, engine);
    captures.push(capture);
    try { publish(`${destination}/raw/${specimen.id}.${engine}.json`, capture); }
    catch (error) { publicationFailure = { caseId: specimen.id, engine, error: errorRecord(error), capture }; throw error; }
    console.log(`${captures.length}/136 ${engine} ${specimen.id}: ${capture.assessment.classification} status=${capture.report?.result?.exitCode ?? "unavailable"} normal=${capture.exitCode === 0 && !capture.signal}`);
  }
} catch (error) { parentError = errorRecord(error); }
finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
if (publicationFailure) publish(`${destination}/unpublished-capture.json`, publicationFailure);
const after = integritySnapshot();
assert.deepEqual(after.snapshotConfig, before.snapshotConfig);
const normalizeNamespace = census => census ? { complete: census.complete, errors: census.errors.map(entry => ({ path: entry.path, name: entry.error.name, code: entry.error.code, message: entry.error.message })), entries: census.entries.map(stable) } : null;
const normalized = capture => ({ exitCode: capture.report?.result?.exitCode ?? null, stdoutBase64: capture.report?.result?.stdoutBase64 ?? null, stderrBase64: capture.report?.result?.stderrBase64 ?? null, classification: capture.assessment.classification, operationalCredit: capture.assessment.operationalCredit, expectationSatisfied: capture.assessment.expectationSatisfied ?? null, before: normalizeNamespace(capture.report?.before), after: normalizeNamespace(capture.report?.after), childExit: capture.exitCode, childSignal: capture.signal, parentTimeout: capture.parentTimeout });
const agreement = captures.map(capture => {
  const author = json(`${attempt}/raw/${capture.caseId}.${capture.engine}.json`);
  const previous = normalized(author);
  const current = normalized(capture);
  const differences = Object.keys(previous).filter(key => JSON.stringify(previous[key]) !== JSON.stringify(current[key]));
  return { caseId: capture.caseId, engine: capture.engine, exactChannelsAndStableNamespace: differences.length === 0, differences, author: { classification: author.assessment.classification, operationalCredit: author.assessment.operationalCredit }, reviewer: { classification: capture.assessment.classification, operationalCredit: capture.assessment.operationalCredit } };
});
const counts = { declaredPrimary: inputs.cases.length, declaredDiagnostics: inputs.diagnostics.length, declaredAttempts: 136, actualAttempts: captures.length, reusedPrefixCaptures: 12, newLaunches, totalReviewerLaunches: 13 + newLaunches, lostDeliveryLaunches: 1, lostDeliveryProductPhase: "unknown: full capture not durably published", productExecCalls: captures.filter(capture => capture.phases.some(phase => phase.phase === "product-exec")).length, normalChildren: captures.filter(capture => capture.exitCode === 0 && !capture.signal && !capture.parentTimeout).length, agreement: agreement.filter(entry => entry.exactChannelsAndStableNamespace).length, disagreement: agreement.filter(entry => !entry.exactChannelsAndStableNamespace).length };
publish(`${destination}/after.json`, { ...after, loadedIntegrity: captures.every(capture => capture.loadedFileEvidence.every(entry => entry.matchesFreeze)), unmatchedLoadedFiles: captures.flatMap(capture => capture.loadedFileEvidence.filter(entry => !entry.matchesFreeze)), serverClosed: !server.listening, requests });
publish(`${destination}/results.json`, { counts, parentError, agreement, observations: captures.map(capture => ({ caseId: capture.caseId, engine: capture.engine, assessment: capture.assessment, raw: `${destination}/raw/${capture.caseId}.${capture.engine}.json` })), comparisonPolicy: "Exact public status/stdout/stderr bytes and entire stable root namespace before/after. Raw metadata retained; timestamps, opaque IDs, inode allocation, elapsed timings and host loader diagnostic PIDs are not repeat-equality fields. Both failing never means parity." });
console.log(JSON.stringify({ destination, counts, parentError }, null, 2));
