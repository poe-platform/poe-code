import assert from "node:assert/strict";

export function account(text) {
  const lines = text.split(/\r?\n/), summary = {}, cases = [];
  let diagnosticIndent;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const total = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/.exec(line);
    if (total) summary[total[1]] = Number(total[2]);
    if (diagnosticIndent !== undefined) { if (line === " ".repeat(diagnosticIndent) + "...") diagnosticIndent = undefined; continue; }
    if (line.trim() === "---") { diagnosticIndent = line.length - line.trimStart().length; continue; }
    const match = /^( *)(not ok|ok) (\d+) - (.*)$/.exec(line); if (!match) continue;
    const indent = match[1].length, details = [];
    for (let following = index + 1; following < lines.length; following++) {
      const candidate = lines[following]; if (candidate.trim() && candidate.length - candidate.trimStart().length <= indent) break; details.push(candidate);
    }
    const block = details.join("\n"), fields = {};
    for (const key of ["type", "failureType", "location", "code", "error"]) { const found = new RegExp("^\\s*" + key + ": (.*)$", "m").exec(block); fields[key] = found?.[1]?.replace(/^['"]|['"]$/g, "") ?? null; }
    const skip = / # SKIP\b(.*)$/i.exec(match[4]), todo = / # TODO\b(.*)$/i.exec(match[4]);
    const status = skip ? "skipped" : todo ? "todo" : ["cancelledByParent", "testTimeoutFailure", "testAborted"].includes(fields.failureType) ? "cancelled" : match[2] === "ok" ? "pass" : "fail";
    cases.push({ id: `tap-line-${index + 1}`, line: index + 1, indent, ordinal: Number(match[3]), name: match[4], status, reason: skip?.[1]?.trim() ?? todo?.[1]?.trim(), ...fields, ...(status === "pass" ? {} : { detail: block }) });
  }
  const tests = cases.filter(entry => entry.type !== "suite"), counts = { pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0 };
  for (const entry of tests) counts[entry.status]++;
  const reconciliation = { completeFooter: Number.isInteger(summary.tests), testInstances: tests.length === summary.tests,
    statuses: Object.fromEntries(Object.entries(counts).map(([name, value]) => [name, value === summary[name]])) };
  const reconciled = reconciliation.completeFooter && reconciliation.testInstances && Object.values(reconciliation.statuses).every(Boolean);
  const skips = tests.filter(entry => entry.status === "skipped").map(entry => ({ ...entry,
    category: /SAFEJS_LOCAL_ROOT/.test(entry.reason ?? "") ? "unavailable-private-engine" : /STREAM_NATIVE_LIVE|BYTE_GNU|\bGNU\b|native|oracle/i.test(entry.reason ?? "") ? "optional-native-oracle-or-profile" : "unclassified-explicit-skip" }));
  const characterizations = tests.filter(entry => /KNOWN UPSTREAM LIMITATION:|documented Rust regex difference|external deadline bounds a catastrophic JavaScript regex probe|POLICY characterization|NONCOMPLIANT characterization/.test(entry.name));
  return { summary, counts, reconciled, reconciliation, cases: tests, suites: cases.filter(entry => entry.type === "suite"), skips, characterizations,
    nonpassing: tests.filter(entry => entry.status !== "pass"), disclaimer: "A passing negative guard is not automatically a defect characterization. Explicit known-limitation/policy names are separately listed, not waived or promoted to feature acceptance." };
}
export function requireReconciled(result) { assert.equal(result.reconciled, true, JSON.stringify(result.reconciliation)); }
