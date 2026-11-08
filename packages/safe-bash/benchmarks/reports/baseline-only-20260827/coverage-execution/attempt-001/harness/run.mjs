import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { root, owned, setup, hash, json, tree, evidence, publish, errorRecord } from "./audit-common.mjs";
import { freeze } from "./freeze-execution.mjs";
import { assess } from "./assess.mjs";

assert.equal(process.cwd(), root);
const destination = process.argv[2] ?? `${owned}/attempt-001`;
assert.ok(destination.startsWith(`${owned}/`) && !destination.includes(".."));
assert.ok(!existsSync(destination), "Never overwrite a previous attempt");
const requests = [];
let activeCase = null;
const server = createServer((request, response) => {
  requests.push({ case: activeCase, method: request.method, path: request.url, remoteAddress: request.socket.remoteAddress });
  const allowed = request.method === "GET" && request.url === "/fixture.txt";
  response.writeHead(allowed ? 200 : 403, { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(allowed ? "loopback-fixture\n" : "denied\n"), "Connection": "close", "Date": "Thu, 01 Jan 1970 00:00:00 GMT" });
  response.end(allowed ? "loopback-fixture\n" : "denied\n");
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const url = `http://127.0.0.1:${server.address().port}/fixture.txt`;
let frozen;
const captures = [];
let parentError = null;

function runChild(specimen, engine) {
  const { inputs } = frozen;
  return new Promise(resolve => {
    const args = ["--import", inputs.paths.trace, ...(engine === "ours" ? ["--import", inputs.paths.tsx] : []), inputs.paths.child, path.resolve(destination, "execution-inputs.json"), engine, specimen.id];
    const started = performance.now();
    const child = spawn(inputs.paths.node, args, { cwd: root, env: inputs.childEnvironment, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const capture = { engine, caseId: specimen.id, pid: child.pid, argv: [inputs.paths.node, ...args], childEnvironment: inputs.childEnvironment, phases: [], parentTimeout: false, stdoutChunks: [], stderrChunks: [], report: null };
    let bytes = 0;
    let cleanupTimer;
    let killTimer;
    const terminate = reason => {
      capture.parentTimeout = true;
      capture.terminationReason = reason;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => { capture.forceKilled = true; child.kill("SIGKILL"); }, inputs.budgets.childGraceMs);
    };
    const guard = setTimeout(() => terminate("child total setup + product + cleanup exceeded configured envelope"), specimen.budgetMs + 2 * inputs.budgets.childGraceMs);
    const collect = field => chunk => {
      bytes += chunk.length;
      capture[field].push(chunk);
      if (bytes > 16 * 1024 * 1024 && !capture.parentTimeout) terminate("host diagnostic output cap");
    };
    child.stdout.on("data", collect("stdoutChunks"));
    child.stderr.on("data", collect("stderrChunks"));
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
      capture.exitCode = code; capture.signal = signal; capture.totalElapsedMs = performance.now() - started;
      const stdout = Buffer.concat(capture.stdoutChunks);
      const stderr = Buffer.concat(capture.stderrChunks);
      delete capture.stdoutChunks; delete capture.stderrChunks;
      capture.hostStdoutBase64 = stdout.toString("base64");
      capture.hostStderrBase64 = stderr.toString("base64");
      capture.moduleTrace = [];
      capture.hostDiagnostics = [];
      for (const line of stderr.toString("utf8").split("\n").filter(Boolean)) {
        if (line.startsWith("COVERAGE_MODULE ")) {
          try { capture.moduleTrace.push(JSON.parse(line.slice("COVERAGE_MODULE ".length))); }
          catch { capture.hostDiagnostics.push(line); }
        } else capture.hostDiagnostics.push(line);
      }
      capture.loadedFileEvidence = [...new Set([...capture.moduleTrace.filter(entry => entry.url.startsWith("file:")).map(entry => fileURLToPath(entry.url)), ...(capture.report?.commonJsModules ?? [])])].sort().map(filename => {
        try { return evidence(filename); } catch (error) { return { path: filename, error: errorRecord(error) }; }
      });
      capture.assessment = assess(specimen, capture);
      resolve(capture);
    });
  });
}

try {
  frozen = freeze(destination, url);
  const { inputs } = frozen;
  publish("/tmp/safe-bash-baseline-coverage-run-status.txt", `FROZEN ${new Date().toISOString()}\nStable reviewer paths: ${destination}/manifest.json, execution-inputs.json, freeze.json.\n61 primary +5 diagnostics per engine; 132 declared engine attempts. Starting isolated children.\n`, true);
  console.log(`FROZEN ${destination} source=${inputs.sourceSha256}`);
  const controls = inputs.cases.filter(specimen => specimen.cohort.startsWith("shared"));
  const remaining = inputs.cases.filter(specimen => !specimen.cohort.startsWith("shared"));
  for (const specimen of [...controls, ...remaining, ...inputs.diagnostics]) {
    for (const engine of ["ours", "baseline"]) {
      activeCase = { engine, id: specimen.id };
      const capture = await runChild(specimen, engine);
      publish(`${destination}/raw/${specimen.id}.${engine}.json`, capture);
      captures.push(capture);
      console.log(`${captures.length}/132 ${engine} ${specimen.id}: ${capture.assessment.classification} status=${capture.report?.result?.exitCode ?? "unavailable"} normal=${capture.exitCode === 0 && !capture.signal}`);
      if (capture.assessment.classification === "harness-error" || capture.report?.captureErrors.length) {
        publish("/tmp/safe-bash-baseline-coverage-run-needs-root.txt", `CAPTURE/SETUP FAULT retained: ${destination}/raw/${specimen.id}.${engine}.json\nNo input/config retargeting. Remaining declared cases continue in fresh isolated children; this outcome is not a product loss.\n`, true);
      }
    }
  }
} catch (error) {
  parentError = errorRecord(error);
  console.error(error);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

if (frozen) {
  const { inputs, manifest } = frozen;
  const post = { capturedAt: new Date().toISOString(), sourceSnapshot: tree(`${inputs.paths.snapshot}/src`), liveSource: tree("src"), dependencies: [tree("node_modules"), tree("benchmarks/node_modules")], harness: manifest.harness.map(entry => evidence(entry.path)), evidence: manifest.evidence.map(entry => evidence(entry.path)), runtimeExecutable: evidence(inputs.paths.node) };
  const integrity = {
    snapshotUnchanged: post.sourceSnapshot.sha256 === manifest.snapshot.sha256,
    liveSourceUnchanged: post.liveSource.sha256 === manifest.source.sha256,
    dependenciesUnchanged: post.dependencies.every((entry, index) => entry.sha256 === manifest.dependencies[index].sha256),
    harnessUnchanged: post.harness.every((entry, index) => entry.sha256 === manifest.harness[index].sha256),
    evidenceUnchanged: post.evidence.every((entry, index) => entry.sha256 === manifest.evidence[index].sha256),
    runtimeExecutableUnchanged: post.runtimeExecutable.sha256 === manifest.node.executable.sha256,
  };
  const known = new Map();
  for (const dependency of manifest.dependencies) for (const entry of dependency.entries) if (entry.sha256) known.set(path.resolve(dependency.directory, entry.path), entry.sha256);
  for (const entry of manifest.snapshot.entries) known.set(path.join(inputs.paths.snapshot, "src", entry.path), entry.sha256);
  for (const entry of manifest.harness) known.set(path.resolve(entry.path), entry.sha256);
  const loadedFiles = [...new Map(captures.flatMap(capture => capture.loadedFileEvidence).map(entry => [entry.path, entry])).values()];
  const loadedAudit = loadedFiles.map(entry => ({ ...entry, frozenSha256: known.get(entry.path) ?? known.get(entry.realpath) ?? null, matchesFreeze: (known.get(entry.path) ?? known.get(entry.realpath)) === entry.sha256 }));
  integrity.allObservedLoadedFilesMatchedFreeze = loadedAudit.every(entry => entry.matchesFreeze);
  publish(`${destination}/post-run.json`, { ...post, integrity, loadedAudit });
  const observations = inputs.cases.map(specimen => {
    const ours = captures.find(capture => capture.caseId === specimen.id && capture.engine === "ours");
    const baseline = captures.find(capture => capture.caseId === specimen.id && capture.engine === "baseline");
    const bothPositive = ours?.assessment.operationalCredit && baseline?.assessment.operationalCredit;
    return { id: specimen.id, name: specimen.name, cohort: specimen.cohort, inputSha256: specimen.inputSha256, ours: ours?.assessment ?? null, baseline: baseline?.assessment ?? null, bothPositive: Boolean(bothPositive), positiveWorkflowAgreement: Boolean(bothPositive) && ours.report.result.stdoutBase64 === baseline.report.result.stdoutBase64 && ours.report.result.stderrBase64 === baseline.report.result.stderrBase64 && JSON.stringify(ours.assessment.fixtureState) === JSON.stringify(baseline.assessment.fixtureState), rawPaths: { ours: `${destination}/raw/${specimen.id}.ours.json`, baseline: `${destination}/raw/${specimen.id}.baseline.json` } };
  });
  const diagnosticObservations = inputs.diagnostics.map(specimen => ({ id: specimen.id, name: specimen.name, ours: captures.find(capture => capture.caseId === specimen.id && capture.engine === "ours")?.assessment ?? null, baseline: captures.find(capture => capture.caseId === specimen.id && capture.engine === "baseline")?.assessment ?? null }));
  const inventory = json(`${setup}/inventory.json`);
  const mapRow = original => ({ originalInventoryRow: original, name: original.name, observation: observations.find(observation => observation.name === original.name), diagnostics: diagnosticObservations.filter(observation => observation.name === original.name) });
  const count = group => Object.fromEntries(["ours", "baseline"].map(engine => [engine, group.reduce((result, observation) => { const label = observation[engine]?.classification ?? "not-executed"; result[label] = (result[label] ?? 0) + 1; return result; }, {})]));
  const counts = { declaredPrimaryRecipes: inputs.cases.length, declaredDiagnostics: inputs.diagnostics.length, declaredEngineAttempts: 132, actualEngineAttempts: captures.length, actualProductExecCalls: captures.filter(capture => capture.phases.some(phase => phase.phase === "product-exec")).length, normalChildren: captures.filter(capture => capture.exitCode === 0 && !capture.signal && !capture.parentTimeout).length, original50: count(observations.filter(observation => observation.cohort === "historical-unmeasured")), optional4: count(observations.filter(observation => observation.cohort === "additional-optional")), primary54: count(observations.filter(observation => ["historical-unmeasured", "additional-optional"].includes(observation.cohort))), historicalOverlap3: count(observations.filter(observation => observation.cohort === "historical-measured-control")), shared4: count(observations.filter(observation => observation.cohort.startsWith("shared"))), diagnostics: count(diagnosticObservations) };
  publish(`${destination}/results.json`, { counts, observations, diagnosticObservations, parentError, integrity, cleanup: { serverClosed: !server.listening, allChildrenNormal: counts.normalChildren === counts.actualEngineAttempts, noRetainedChildren: true, snapshotRetainedForReview: inputs.paths.snapshot } });
  publish(`${destination}/matrix.json`, { historical: inventory.historical, rows: inventory.rows.map(mapRow), additionalOptional: inventory.addedOptional.map(mapRow), sharedControls: observations.filter(observation => observation.cohort.startsWith("shared")), counts });
  publish(`${destination}/network.json`, { fixture: inputs.network, requests, serverClosed: !server.listening });
  console.log(JSON.stringify({ destination, counts, integrity, parentError }, null, 2));
} else {
  publish("/tmp/safe-bash-baseline-coverage-run-needs-root.txt", `PRE-FREEZE HARNESS FAULT, zero product calls: ${JSON.stringify(parentError)}\n`, true);
  process.exitCode = 1;
}
