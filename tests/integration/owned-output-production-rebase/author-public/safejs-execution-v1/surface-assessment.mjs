import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export function createSurfaceAssessor(cohort) {
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
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
return assess;
}
