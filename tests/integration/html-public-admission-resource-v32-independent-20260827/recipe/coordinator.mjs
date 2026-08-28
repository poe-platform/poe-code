import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { here, pin, repository } from "../../html-public-independent-20260827/admission-v3.2/recipe/authenticate.mjs";
import { errorRecord, fileHash, journal, json, memory, readJson } from "../../html-public-independent-20260827/admission-v3.2/recipe/telemetry.mjs";
import { terminalPredicate } from "../../html-public-independent-20260827/admission-v3.2/recipe/terminal-predicate.mjs";
import { intactBindings } from "../../html-public-independent-20260827/admission-v3.2/recipe/bindings.mjs";
import { orderedPredicate, runIndependent, safetyGate } from "../../html-public-independent-20260827/admission-v3.2/recipe/aggregation.mjs";

const [freeze, manifestSha, outputArgument] = process.argv.slice(2);
const output = resolve(outputArgument ?? ".");
const owned = resolve(repository, "tests/integration/html-public-admission-resource-v32-independent-20260827");
const outputRelative = relative(owned, output);
assert.ok(outputRelative && !outputRelative.startsWith("..") && !isAbsolute(outputRelative));
assert.ok(!output.startsWith(`${here}/`));
const pre = intactBindings(freeze, manifestSha);
mkdirSync(output);
json(join(output, "PRE.json"), pre);
const policy = pin.policy;
function groupMembers(group) {
  if (!group) return [];
  const result = spawnSync(pin.tools.ps.path, ["-axo", "pid=,ppid=,pgid=,stat=,command="], { encoding: "utf8", maxBuffer: 4 * 1024 ** 2, timeout: 10000, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  if (result.error || result.status !== 0) throw new Error(`PS_FAILURE:${result.error?.message ?? result.stderr}`);
  return result.stdout.split("\n").filter(line => Number(line.trim().split(/\s+/u)[2]) === group);
}
function pidState(pid) {
  if (!pid) return { pid: null, state: "not-observed" };
  try { process.kill(pid, 0); return { pid, state: "live-or-zombie" }; }
  catch (error) { return { pid, state: error.code === "ESRCH" ? "absent" : "unknown", error: error.code }; }
}
function optionalJson(path) {
  try { return { value: readJson(path), error: null }; }
  catch (error) { return { value: null, error: errorRecord(error) }; }
}
async function controlRun(control, ordinal) {
  const directory = join(output, `${String(ordinal).padStart(2, "0")}-${control}`);
  mkdirSync(directory);
  mkdirSync(join(directory, "tmp"));
  const rawLog = journal(join(directory, "supervisor.events.jsonl"));
  let journalOpen = true;
  const log = { append: row => { if (journalOpen) rawLog.append(row); }, close: () => { journalOpen = false; rawLog.close(); } };
  const observer = memory(log, "supervisor-excluded-from-component-limit");
  const env = { PATH: `${dirname(pin.tools.node.path)}:/usr/bin:/bin`, HOME: join(directory, "tmp"), TMPDIR: join(directory, "tmp"), LC_ALL: "C", LANG: "C", TZ: "UTC" };
  const args = [policy.heapFlag, join(here, "worker.mjs"), control, directory];
  const record = { control, started: new Date().toISOString(), executable: pin.tools.node.path, args, cwd: repository, env, freeze, manifestSha256: manifestSha, signalsSent: [], messages: [], unexpected: [], deadlineMs: policy.controlDeadlineMs, naturalConsumerClose: false, ready: false, receiptForwarded: false, timeoutTriggered: false, resourceBoundary: null, producerPid: null, stdoutBytes: 0, stderrBytes: 0 };
  json(join(directory, "START.json"), record);
  const child = spawn(pin.tools.node.path, args, { cwd: repository, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  record.pid = child.pid ?? null;
  const stdout = [], stderr = [];
  let escalation, abortGrace, controlTimeout, closed = false, exited = false, abortSent = false;
  function signalGroup(signal, reason) {
    if (!child.pid || exited || child.exitCode !== null || child.signalCode !== null) {
      record.unexpected.push({ code: "V32_GROUP_OWNERSHIP_LOST", message: reason });
      return;
    }
    let members;
    try { members = groupMembers(child.pid); }
    catch (error) { record.unexpected.push(errorRecord(error)); return; }
    const event = { type: "signal-group", pid: child.pid, signal, reason, leaderExitObserved: exited, members };
    log.append(event);
    record.signalsSent.push(event);
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") record.unexpected.push(errorRecord(error)); }
  }
  function emergency(reason) {
    record.unexpected.push({ code: "V3_SUPERVISOR_EMERGENCY", message: reason });
    signalGroup("SIGTERM", reason);
    if (!escalation) escalation = setTimeout(() => signalGroup("SIGKILL", "emergency grace exhausted"), policy.cleanupGraceMs);
  }
  function send(message) {
    log.append({ type: "send", ...message });
    if (!child.connected) { emergency("IPC disconnected before decision"); return; }
    child.send(message, error => { if (error && !closed) emergency(`IPC send: ${error.message}`); });
  }
  function abort(code) {
    if (abortSent) return;
    abortSent = true;
    send({ type: "abort", code });
    abortGrace = setTimeout(() => emergency("cooperative cleanup grace exhausted"), policy.cleanupGraceMs);
  }
  for (const [name, stream, chunks] of [["stdout", child.stdout, stdout], ["stderr", child.stderr, stderr]]) {
    stream.on("data", bytes => {
      record[`${name}Bytes`] += bytes.length;
      if (record[`${name}Bytes`] <= 65536) chunks.push(Buffer.from(bytes));
      else emergency(`${name} exceeds 65536 bytes`);
    });
  }
  const closure = new Promise(resolveClosure => {
    child.on("error", error => { record.spawnError = errorRecord(error); log.append({ type: "child-error", error: record.spawnError }); });
    child.on("exit", (code, signal) => { exited = true; record.exitObserved = { code, signal, at: new Date().toISOString() }; log.append({ type: "child-exit", ...record.exitObserved }); });
    child.on("close", (code, signal) => { closed = true; log.append({ type: "child-close", code, signal }); resolveClosure({ code, signal }); });
  });
  child.on("message", message => {
    try {
      record.messages.push(message);
      log.append({ type: "received", message });
      observer.sample("child-message");
      if (message.type === "ready") { record.ready = true; record.producerPid = message.producer.pid; record.membersAtReady = groupMembers(child.pid); }
      else if (message.type === "timeout-ready" && control === "timeout") {
        controlTimeout = setTimeout(() => { record.timeoutTriggered = true; abort("V3_TIMEOUT"); }, policy.timeoutAfterReadyMs);
      } else if (message.type === "allocation" && control === "allocation-mutant") {
        if (message.row.memory.rss >= policy.rssExclusiveBytes) {
          record.resourceBoundary = message.row;
          json(join(directory, "RESOURCE-BOUNDARY.json"), { thresholdBytes: policy.rssExclusiveBytes, operator: ">=", row: message.row, action: "pause further allocation, abort core consumption, await producer close and receipt, then SIGTERM consumer" });
          abort("V3_RSS_LIMIT");
        } else send({ type: "continue" });
      } else if (message.type === "receipt") {
        record.receiptForwarded = true;
        record.forwardedFailureCode = message.code;
        record.forwardedFailureMessage = message.message;
        if (control === "allocation-mutant" && record.resourceBoundary && message.code === "V3_RSS_LIMIT") {
          const producer = optionalJson(join(directory, "producer.receipt.json"));
          const consumer = optionalJson(join(directory, "consumer.receipt.json"));
          json(join(directory, "BEFORE-KILL.json"), { consumer, producer, producerState: pidState(record.producerPid), memory: observer.snapshot(), reason: "intentional allocation mutant only; numeric receipt durable before termination or assertions" });
          if (!consumer.value?.orderedObservation?.completed || consumer.value.orderedObservation.error || producer.error || consumer.error || consumer.value.pid !== child.pid || producer.value.pid !== record.producerPid || !consumer.value.orderedObservation.events.some(event => event.type === "producer-close")) {
            emergency("allocation receipt lacks completed owned producer cleanup");
            return;
          }
          const event = { type: "signal-child", pid: child.pid, signal: "SIGTERM", reason: "allocation mutant reached absolute RSS boundary; receipt and producer settlement complete" };
          log.append(event);
          record.signalsSent.push(event);
          event.signalAccepted = child.kill("SIGTERM");
        }
      } else emergency(`unexpected protocol message: ${message.type}`);
    } catch (error) { record.unexpected.push(errorRecord(error)); emergency("message handler failed"); }
  });
  const deadline = setTimeout(() => emergency("control deadline exhausted"), policy.controlDeadlineMs);
  let hardDeadline;
  const terminal = await Promise.race([closure, new Promise(resolveDeadline => {
    hardDeadline = setTimeout(() => resolveDeadline(null), policy.controlDeadlineMs + 2 * policy.cleanupGraceMs);
  })]);
  if (terminal) Object.assign(record, terminal);
  else {
    record.unexpected.push({ code: "V32_REAP_DEADLINE", message: "bounded supervisor wait expired; no cleanup/reap proof; cohort must stop" });
    signalGroup("SIGKILL", "final bounded cleanup attempt");
    child.stdout.destroy();
    child.stderr.destroy();
    if (child.connected) child.disconnect();
    child.unref();
  }
  clearTimeout(hardDeadline);
  clearTimeout(deadline);
  clearTimeout(escalation);
  clearTimeout(abortGrace);
  clearTimeout(controlTimeout);
  record.closeObserved = terminal !== null;
  record.naturalConsumerClose = record.signalsSent.length === 0 && record.signal === null;
  record.finished = new Date().toISOString();
  try {
    record.membersAtClose = groupMembers(child.pid);
    if (record.membersAtClose.length) {
      record.unexpected.push({ code: "V32_GROUP_NOT_REAPED", message: "no signal based on stale post-exit leader PID; cohort stops" });
    }
    record.remainingGroupMembers = groupMembers(child.pid);
  } catch (error) { record.unexpected.push(errorRecord(error)); record.remainingGroupMembers = null; }
  record.consumerState = pidState(child.pid);
  record.producerState = pidState(record.producerPid);
  record.consumer = optionalJson(join(directory, "consumer.receipt.json"));
  record.producer = optionalJson(join(directory, "producer.receipt.json"));
  record.producerCloseProof = record.consumer.value?.result?.process ?? record.consumer.value?.failure?.process ?? null;
  if (control === "producer-exit7" && record.consumer.value?.failure?.code === "STREAM_PROCESS") {
    try { record.producerCloseProof = JSON.parse(record.consumer.value.failure.message.slice("BOUNDARY:STREAM_PROCESS ".length)); }
    catch (error) { record.unexpected.push(errorRecord(error)); }
  }
  record.operationSucceeded = record.code === 0 && record.signal === null && record.consumer.value?.failure === null;
  observer.sample("after-reap");
  record.supervisorMemoryExcluded = observer.snapshot();
  record.assertionState = "not evaluated; all available numeric and process outcomes durable first";
  writeFileSync(join(directory, "stdout.data"), Buffer.concat(stdout), { flag: "wx" });
  writeFileSync(join(directory, "stderr.data"), Buffer.concat(stderr), { flag: "wx" });
  record.outputHashes = { stdout: fileHash(join(directory, "stdout.data")), stderr: fileHash(join(directory, "stderr.data")) };
  record.harnessSettlementAt = new Date().toISOString();
  json(join(directory, "RAW-RECEIPT.json"), record);
  let bindingAttestation;
  try { bindingAttestation = { authentication: intactBindings(freeze, manifestSha), error: null }; }
  catch (error) { bindingAttestation = { authentication: null, error: errorRecord(error) }; }
  json(join(directory, "BINDINGS.json"), bindingAttestation);
  const numeric = telemetry => ["baseline", "fieldwisePeaks", "latest"].every(phase => ["rss", "heapUsed", "heapTotal", "external", "arrayBuffers"].every(field => Number.isSafeInteger(telemetry?.memory?.[phase]?.[field]) && telemetry.memory[phase][field] >= 0));
  const consumerProof = record.consumer.value, producerProof = record.producer.value;
  const safety = safetyGate({
    bindingsIntact: bindingAttestation.error === null,
    receiptPresent: record.receiptForwarded && record.consumer.error === null && record.producer.error === null && consumerProof?.pid === child.pid && producerProof?.pid === record.producerPid && producerProof?.ppid === child.pid,
    numericReceiptPresent: numeric(consumerProof) && numeric(producerProof),
    closeObserved: record.closeObserved && Boolean(record.exitObserved),
    reaped: record.closeObserved && record.consumerState.state === "absent" && record.producerState.state === "absent" && record.producerPid !== null && record.producerCloseProof !== null,
    groupEmpty: record.membersAtClose?.length === 0 && record.remainingGroupMembers?.length === 0,
    cleanupComplete: record.unexpected.length === 0 && !record.spawnError && (!["timeout", "allocation-mutant"].includes(control) || (consumerProof?.orderedObservation?.completed === true && consumerProof.orderedObservation.error === null)),
  });
  json(join(directory, "SAFETY.json"), safety);
  let verdict;
  try {
    assert.equal(safety.safe, true, JSON.stringify(safety));
    assert.equal(record.spawnError, undefined);
    assert.deepEqual(record.unexpected, []);
    assert.equal(record.ready, true);
    assert.equal(record.receiptForwarded, true);
    assert.equal(record.closeObserved, true);
    assert.deepEqual(record.membersAtClose, []);
    assert.deepEqual(record.remainingGroupMembers, []);
    assert.equal(record.consumerState.state, "absent");
    assert.equal(record.producerState.state, "absent");
    assert.equal(record.stdoutBytes, 0);
    assert.equal(record.stderrBytes, 0);
    assert.equal(record.consumer.error, null);
    assert.equal(record.producer.error, null);
    assert.equal(record.operationSucceeded, control === "positive");
    const consumer = record.consumer.value, producer = record.producer.value;
    for (const telemetry of [consumer, producer]) {
      for (const phase of ["baseline", "fieldwisePeaks", "latest"]) for (const field of ["rss", "heapUsed", "heapTotal", "external", "arrayBuffers"]) assert.ok(Number.isSafeInteger(telemetry.memory[phase][field]) && telemetry.memory[phase][field] >= 0);
      assert.ok(telemetry.memory.samples > 0);
    }
    assert.equal(consumer.coreSha256, pre.recipeInventory.files["core.mjs"]);
    assert.equal(consumer.flow.pending, 0);
    assert.equal(consumer.flow.pendingBytes, 0);
    assert.equal(consumer.flow.maxPending, 1);
    assert.ok(consumer.flow.maxChunkBytes <= 65536);
    assert.ok(consumer.flow.maxPendingBytes <= 65536);
    assert.ok(producer.flow.maxChunkBytes <= 65536);
    assert.ok(producer.flow.maxPendingDrains <= 1);
    if (control === "positive" || control === "producer-exit7") {
      assert.equal(record.code, control === "positive" ? 0 : 17);
      assert.equal(record.signal, null);
      assert.equal(record.naturalConsumerClose, true);
      assert.equal(consumer.flow.bytes, policy.bytes);
      assert.equal(consumer.observedSha256, policy.sha256);
      assert.equal(producer.status, control === "positive" ? 0 : 7);
      assert.equal(producer.signal, null);
      assert.equal(producer.flow.acceptedBytes, policy.bytes);
      assert.equal(producer.flow.writes, policy.producerWrites);
      assert.ok(producer.flow.falseWrites > 0);
      assert.equal(producer.flow.falseWrites, producer.flow.drains);
      assert.equal(producer.flow.pendingDrains, 0);
      if (control === "positive") {
        assert.equal(consumer.failure, null);
        assert.equal(consumer.result.bytes, policy.bytes);
        assert.equal(consumer.result.sha256, policy.sha256);
        assert.equal(consumer.result.chunks, consumer.flow.chunks);
        assert.ok(consumer.result.maxRssBytes < policy.rssExclusiveBytes);
        assert.ok(consumer.memory.fieldwisePeaks.rss < policy.rssExclusiveBytes);
        assert.ok(consumer.result.maxProducerChunkBytes <= 1048576);
        assert.equal(consumer.result.process.status, 0);
        assert.equal(consumer.result.process.signal, null);
        const nativeProducer = JSON.parse(consumer.result.process.stderr);
        assert.equal(nativeProducer.emitted, policy.bytes);
        assert.equal(nativeProducer.drains, producer.flow.drains);
      } else {
        assert.equal(consumer.failure.code, "STREAM_PROCESS");
        const processResult = JSON.parse(consumer.failure.message.slice("BOUNDARY:STREAM_PROCESS ".length));
        assert.equal(processResult.status, 7);
        assert.equal(processResult.signal, null);
        assert.equal(record.forwardedFailureCode, "STREAM_PROCESS");
      }
    } else {
      const expected = { "consumer-failure": "V3_CONSUMER_FAILURE", timeout: "V3_TIMEOUT", "allocation-mutant": "V3_RSS_LIMIT" }[control];
      assert.equal(consumer.failure.code, expected);
      assert.equal(record.forwardedFailureCode, expected);
      assert.ok(consumer.flow.bytes > 0 && consumer.flow.bytes < policy.bytes);
      if (control === "consumer-failure") {
        const terminal = terminalPredicate(record, policy);
        json(join(directory, "TERMINAL-PREDICATE.json"), terminal);
        assert.equal(terminal.accepted, true, JSON.stringify(terminal));
      } else {
        assert.equal(producer.signal, "SIGTERM");
        assert.equal(consumer.failure.process.signal, "SIGTERM");
        const accepted = orderedPredicate(record);
        json(join(directory, "ORDERED-PREDICATE.json"), { accepted });
        assert.equal(accepted, true);
      }
      if (control === "allocation-mutant") {
        assert.ok(record.resourceBoundary.memory.rss >= policy.rssExclusiveBytes);
        assert.ok(record.resourceBoundary.memory.rss < policy.rssExclusiveBytes + policy.allocationOvershootMaxBytes);
        assert.equal(record.resourceBoundary.mutation.retainedBytes, consumer.mutation.retainedBytes);
        assert.ok(consumer.mutation.steps > 1 && consumer.mutation.steps <= policy.allocationMaxSteps);
        assert.equal(consumer.mutation.retainedBytes, consumer.mutation.steps * policy.allocationStepBytes);
        assert.equal(consumer.mutation.touchedByte, 180);
        assert.ok(consumer.memory.fieldwisePeaks.external > consumer.memory.baseline.external + consumer.mutation.retainedBytes - policy.allocationStepBytes);
        assert.equal(record.signal, "SIGTERM");
        assert.equal(record.code, null);
        assert.equal(record.signalsSent.length, 1);
        assert.equal(readJson(join(directory, "BEFORE-KILL.json")).producerState.state, "absent");
      } else {
        assert.equal(record.code, 17);
        assert.equal(record.signal, null);
        assert.equal(consumer.flow.chunks, 16);
        assert.equal(record.signalsSent.length, 0);
        assert.equal(record.timeoutTriggered, control === "timeout");
      }
    }
    verdict = { control, outcome: "expected-control-outcome", productPass: control === "positive" ? "isolated stream only; not admission" : false };
  } catch (error) { verdict = { control, outcome: "unexpected-control-failure", error: errorRecord(error), productPass: false }; }
  json(join(directory, "VERDICT.json"), verdict);
  log.close();
  return { ...verdict, safety, directory: relative(output, directory), code: record.code, signal: record.signal, forcedConsumerTermination: record.signalsSent.length > 0, producerStatus: record.producer.value?.status ?? null, producerSignal: record.producer.value?.signal ?? null };
}
const cohort = await runIndependent(policy.controls, async (control, ordinal) => {
  const row = await controlRun(control, ordinal);
  console.log(JSON.stringify(row));
  return row;
});
const rows = cohort.rows;
let post;
try { post = { authentication: intactBindings(freeze, manifestSha), error: null }; }
catch (error) { post = { authentication: null, error: errorRecord(error) }; }
json(join(output, "POST.json"), post);
const summary = { freeze, manifestSha256: manifestSha, controlsDeclared: policy.controls.length, controlsExecuted: rows.length, expectedOutcomes: rows.filter(row => row.outcome === "expected-control-outcome").length, unexpectedFailures: rows.filter(row => row.outcome !== "expected-control-outcome").length, rows, unexecuted: policy.controls.slice(rows.length), postAuthenticated: post.error === null, actual34: 0, extraMaterializerControls: 0, full410BuildPackReconstruction: false, admission: "HELD pending different independent review", scope: "fresh stream-component consumer PROCESS current-RSS samples only; supervisor and producer explicitly separate, not total verifier RSS" };
summary.independentScope = { synthetic: "not executed; static-only", forwarding: "not executed; static-only", orderedSynthetic: "not executed; static-only" };
summary.aggregation = { policy: "continue ordinary semantic failure only after per-case safe cleanup and intact bindings; unsafe or missing proof stops", exitCode: cohort.exitCode };
json(join(output, "SUMMARY.json"), summary);
process.exitCode = summary.unexpectedFailures || summary.unexecuted.length || post.error ? 1 : 0;
