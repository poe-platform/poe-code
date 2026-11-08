import { isDeepStrictEqual } from "node:util";
import { runVirtualScript, sourceEvidence } from "../../../tests/shell-stress/helpers.js";
import { comparable, references, validateReferences, virtualFixture } from "../../../tests/shell-stress/targeted-holdout/frozen.js";
import type { Observation } from "../../../tests/shell-stress/model.js";

validateReferences();
const name = process.argv[2] ?? "baseline";
if (!/^[a-z][a-z0-9-]*$/u.test(name)) throw new Error("Invalid artifact name");
const filter = process.argv[3];
const before = sourceEvidence();
const rows = [];
for (const row of references.cases.filter(row => !filter || row.fixture.name.includes(filter) || row.fixture.group === filter)) {
  const sampleBefore = sourceEvidence();
  let actual: Observation | undefined;
  let error: string | undefined;
  try { actual = await runVirtualScript(virtualFixture(row.fixture)); }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
  const sampleAfter = sourceEvidence();
  const changedSources = [...new Set([...Object.keys(sampleBefore.hashes), ...Object.keys(sampleAfter.hashes)])].filter(path => sampleBefore.hashes[path] !== sampleAfter.hashes[path]);
  const expectedComparable = comparable(row.primary);
  const actualComparable = actual ? comparable(actual) : undefined;
  const mismatchFields = actualComparable ? (Object.keys(expectedComparable) as (keyof Observation)[]).filter(key => !isDeepStrictEqual(expectedComparable[key], actualComparable[key])) : [];
  const outcome = changedSources.length || error?.includes("Source changed") || error?.includes("source changed") ? "invalidated" : error ? "error" : mismatchFields.length ? "fail" : "pass";
  rows.push({ fixture: row.fixture, before: sampleBefore, after: sampleAfter, changedSources, outcome, mismatchFields, expected: row.primary, actual, legacy: row.legacy, legacyDiffers: row.differs, error });
  process.stderr.write(`${outcome}: ${row.fixture.group}/${row.fixture.name}${mismatchFields.length ? ` [${mismatchFields.join(",")}]` : ""}\n`);
}
const after = sourceEvidence();
const report = {
  before, after, filter: filter ?? null,
  normalization: "Only line-leading executable names shell-stress:, bash:, and shell: become <shell>:. No line numbers, diagnostic wording, status, stdout, or file bytes normalized. Raw paired observations retained.",
  harnessCorrection: "Initial baseline omitted virtual shell: from executable-name normalization. Calibrated runs cover all three names symmetrically; baseline raw evidence remains unchanged. Virtual execution now explicitly receives the fixture LANG/LC_ALL, matching native capture instead of relying on the runtime default.",
  primary: references.primary, legacy: references.legacy,
  totals: { cases: rows.length, pass: rows.filter(row => row.outcome === "pass").length, fail: rows.filter(row => row.outcome === "fail").length, error: rows.filter(row => row.outcome === "error").length, invalidated: rows.filter(row => row.outcome === "invalidated").length }, rows,
};
const findings = [
  `INDEPENDENT TARGETED SHELL HOLDOUT — ${name} — ${new Date().toISOString()}`,
  `Totals: ${JSON.stringify(report.totals)}`,
  `Run source aggregate before=${before.aggregate} after=${after.aggregate}; revision=${before.revision}`,
  `Reference: ${references.primary.stdout.split("\n")[0]} sha256=${references.primary.sha256}`,
  `FULL RAW ARTIFACT: /Users/kjopek/Workspace/safe-bash/benchmarks/shell-stress/targeted-holdout/${name}.json`,
  "Scope: 49 frozen new cases; paired original Bash3.2 captures unchanged. No skips or diagnostic waivers. Each case carries exact inputs and all raw output bytes/status/file effects.",
  "Classification at initial capture: descriptor/read/shortcut/pathname groups were committed; ANSI group first committed 0aeaaf4 during setup and may be receiving followups; fatal/prevalidation groups still pending author completion. Active failures in pending groups are not claimed as new regressions.",
  report.normalization,
  report.harnessCorrection,
  "UTF8/C limitations remain active failures when observed; no silent locale exception. A source-invalidated sample is NOT an attributable failure or pass.",
  "GROUP | CASE | OUTCOME | MISMATCH FIELDS | SOURCE SHA256 PREFIX",
  rows.map(row => `${row.fixture.group} | ${row.fixture.name} | ${row.outcome} | ${row.mismatchFields.join(",") || "-"} | ${row.before.aggregate.slice(0, 16)}${row.changedSources.length ? ` -> ${row.after.aggregate.slice(0, 16)} INVALIDATED` : ""}`).join("\n"),
  "NON-DIAGNOSTIC FAILURES (full scripts/inputs/raw bytes/status/file effects and complete source hashes remain in the artifact):",
  ...rows.filter(row => row.outcome === "fail" && row.mismatchFields.some(field => field !== "stderr" && field !== "stderrBase64")).map(row => JSON.stringify({ name: row.fixture.name, script: row.fixture.script, stdin: row.fixture.stdin ?? "", initialFiles: row.fixture.initialFiles ?? {}, expected: { stdoutBase64: row.expected.stdoutBase64, exitCode: row.expected.exitCode, files: row.expected.files }, actual: { stdoutBase64: row.actual?.stdoutBase64, exitCode: row.actual?.exitCode, files: row.actual?.files } })),
].join("\n\n");
console.log(`*** Begin Patch\n*** Add File: benchmarks/shell-stress/targeted-holdout/${name}.json\n${JSON.stringify(report, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** Add File: /tmp/safe-bash-shell-heldout-findings.txt\n${findings.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch`);
process.exitCode = rows.every(row => row.outcome === "pass") ? 0 : 1;
