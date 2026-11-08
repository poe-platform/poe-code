import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { here, pin } from "./authenticate.mjs";
import { errorRecord, fileHash, json, readJson } from "./telemetry.mjs";
import { orderedPredicate, runIndependent, safetyGate } from "./aggregation.mjs";

export async function runForwardingControls(output, policy, authenticate) {
  const directory = join(output, "forwarding-controls");
  mkdirSync(directory);
  const declarations = readJson(join(here, "FORWARDING-CASES.json"));
  const actual = [], predicates = [];
  let safe = true;
  for (const declaration of declarations.actualSupervisionCohorts) {
    const cohortDirectory = join(directory, declaration.name);
    mkdirSync(cohortDirectory);
    const cohort = await runIndependent([declaration.mode, "marker"], async (mode, ordinal) => {
      const caseDirectory = join(cohortDirectory, `${ordinal}-${mode}`);
      mkdirSync(caseDirectory);
      const binding = join(caseDirectory, "binding.data");
      writeFileSync(binding, "original\n", { flag: "wx" });
      const bindingHash = fileHash(binding);
      const pre = authenticate();
      json(join(caseDirectory, "PRE.json"), pre);
      const started = performance.now();
      const child = spawn(pin.tools.node.path, [policy.heapFlag, join(here, "forwarding-worker.mjs"), mode, caseDirectory], {
        cwd: caseDirectory, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", HOME: caseDirectory, TMPDIR: caseDirectory }, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      const raw = { mode, pid: child.pid, receipt: null, signals: [], exit: null, close: null, error: null, startedAt: new Date().toISOString(), assertionState: "not evaluated" };
      let escalation, hardTimer, deadline;
      const signal = name => raw.signals.push({ signal: name, accepted: child.kill(name), at: new Date().toISOString() });
      const closure = new Promise(resolveClose => {
        child.on("error", error => { raw.error = errorRecord(error); });
        child.once("exit", (code, terminalSignal) => { raw.exit = { code, signal: terminalSignal }; });
        child.once("close", (code, terminalSignal) => { raw.close = { code, signal: terminalSignal }; resolveClose(true); });
      });
      child.on("message", message => {
        if (mode === "ignore-term" && message.type === "ready") {
          signal("SIGTERM");
          escalation = setTimeout(() => signal("SIGKILL"), policy.cleanupGraceMs);
        }
      });
      deadline = setTimeout(() => signal("SIGKILL"), policy.controlDeadlineMs);
      const closed = await Promise.race([closure, new Promise(resolveTimeout => { hardTimer = setTimeout(() => resolveTimeout(false), policy.controlDeadlineMs + 2 * policy.cleanupGraceMs); })]);
      clearTimeout(deadline); clearTimeout(escalation); clearTimeout(hardTimer);
      if (!closed) { signal("SIGKILL"); if (child.connected) child.disconnect(); child.unref(); }
      raw.elapsedMs = performance.now() - started;
      raw.closeObserved = closed;
      try { process.kill(child.pid, 0); raw.pidState = "live-or-zombie"; }
      catch (error) { raw.pidState = error.code === "ESRCH" ? "absent" : "unknown"; }
      const processTable = spawnSync(pin.tools.ps.path, ["-axo", "pid=,ppid=,pgid=,stat=,command="], { encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 ** 2 });
      raw.groupMembers = processTable.status === 0 && !processTable.error ? processTable.stdout.split("\n").filter(line => Number(line.trim().split(/\s+/u)[2]) === child.pid) : null;
      try { raw.receipt = readJson(join(caseDirectory, "child.receipt.json")); }
      catch (error) { raw.receiptError = errorRecord(error); }
      raw.bindingHash = fileHash(binding);
      raw.originalBindingHash = bindingHash;
      raw.markerPresent = existsSync(join(caseDirectory, "MARKER.json"));
      json(join(caseDirectory, "RAW-RECEIPT.json"), raw);
      let post;
      try { post = { authentication: authenticate(), error: null }; }
      catch (error) { post = { authentication: null, error: errorRecord(error) }; }
      json(join(caseDirectory, "POST.json"), post);
      const physicalSafety = closed && raw.exit !== null && raw.pidState === "absent" && raw.groupMembers?.length === 0 && !raw.error && !post.error;
      safe &&= physicalSafety;
      const proof = safetyGate({
        bindingsIntact: !post.error && raw.bindingHash === bindingHash,
        receiptPresent: raw.receipt?.pid === child.pid,
        numericReceiptPresent: Number.isSafeInteger(raw.receipt?.memory?.baseline?.rss) && Number.isSafeInteger(raw.receipt?.memory?.fieldwisePeaks?.rss),
        closeObserved: closed,
        reaped: physicalSafety && mode !== "omit-reap-proof",
        groupEmpty: raw.groupMembers?.length === 0,
        cleanupComplete: physicalSafety && mode !== "ignore-term",
      });
      json(join(caseDirectory, "SAFETY.json"), { physicalSafety, proof, injectedReapOmission: mode === "omit-reap-proof" });
      const outcome = raw.close?.code === 0 && raw.close.signal === null && raw.receipt?.reason === "EXACT_FORWARDING_REASON" && (mode !== "marker" || raw.markerPresent) ? "expected-control-outcome" : "unexpected-control-failure";
      return { mode, outcome, safety: proof, physicalSafety, receiptReason: raw.receipt?.reason, close: raw.close, signals: raw.signals };
    });
    let verdict;
    try {
      assert.equal(cohort.rows.length, declaration.expectedExecuted);
      assert.equal(cohort.exitCode, declaration.expectedExit);
      assert.ok(cohort.rows.every(row => row.physicalSafety));
      assert.equal(cohort.rows.some(row => row.mode === "marker"), declaration.expectedExecuted === 2);
      if (declaration.expectedExecuted === 2) {
        assert.equal(cohort.rows[0].outcome, "unexpected-control-failure");
        assert.equal(cohort.rows[0].safety.safe, true);
        assert.equal(cohort.rows[1].outcome, "expected-control-outcome");
      } else assert.equal(cohort.rows[0].safety.safe, false);
      if (declaration.mode === "ignore-term") {
        assert.equal(cohort.rows[0].close.signal, "SIGKILL");
        assert.deepEqual(cohort.rows[0].signals.map(event => event.signal), ["SIGTERM", "SIGKILL"]);
        assert.ok(cohort.rows[0].signals.every(event => event.accepted));
      }
      if (declaration.mode === "wrong-reason") assert.notEqual(cohort.rows[0].receiptReason, "EXACT_FORWARDING_REASON");
      verdict = { name: declaration.name, expected: true, cohort };
    } catch (error) { verdict = { name: declaration.name, expected: false, error: errorRecord(error), cohort }; }
    actual.push(verdict);
    json(join(cohortDirectory, "VERDICT.json"), verdict);
    if (!safe) break;
  }
  for (const declaration of safe ? declarations.syntheticOrderedPredicates : []) {
    const code = declaration.control === "timeout" ? "V3_TIMEOUT" : "V3_RSS_LIMIT";
    const terminal = { status: null, signal: "SIGTERM" };
    const record = { control: declaration.control, forwardedFailureCode: code, forwardedFailureMessage: `CONTROL_BOUNDARY:${code}`, producer: { value: { ...terminal } }, consumer: { value: {
      failure: { code, message: `CONTROL_BOUNDARY:${code}`, process: { ...terminal } },
      orderedObservation: { completed: true, error: null, sameFailureObject: true, signalAccepted: true, exit: { ...terminal }, close: { ...terminal }, events: ["stop-request", "producer-exit", "owned-pipe-destroy", "producer-close", "throw-original", "core-settled"].map((type, index) => ({ type, sequence: index + 1, pipeDestroyed: false })) },
    } } };
    if (declaration.mutation === "reason") record.forwardedFailureCode = "WRONG_REASON";
    if (declaration.mutation === "terminal") { record.producer.value.status = 1; record.producer.value.signal = null; }
    if (declaration.mutation === "identity") record.consumer.value.orderedObservation.sameFailureObject = false;
    if (declaration.mutation === "ordering") record.consumer.value.orderedObservation.events[1].pipeDestroyed = true;
    json(join(directory, `${declaration.name}-INPUT.json`), { declaration, record });
    const accepted = orderedPredicate(record);
    predicates.push({ name: declaration.name, accepted, expected: accepted === declaration.expected });
  }
  const result = { actual, predicates, safe, actualDeclared: declarations.actualSupervisionCohorts.length, syntheticDeclared: declarations.syntheticOrderedPredicates.length, qualification: declarations.qualification,
    allExpected: actual.length === declarations.actualSupervisionCohorts.length && predicates.length === declarations.syntheticOrderedPredicates.length && actual.every(row => row.expected) && predicates.every(row => row.expected) };
  json(join(directory, "SUMMARY.json"), result);
  return result;
}
