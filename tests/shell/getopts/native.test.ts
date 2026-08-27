import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createGetoptsState, scanGetopts, withGetoptsIndex } from "../../../src/shell/getopts.js";
import type { GetoptsScanResult } from "../../../src/shell/getopts.js";
import { options, view } from "./helpers.js";

interface ScanFact {
  operation: "scan";
  optstring: string;
  args: string[];
  reportErrors: boolean;
  source: { rawFile: string; caseId: string; profile: string; line: string };
  expected: Omit<GetoptsScanResult, "state">;
}

interface Cohort {
  projectedScanObservations: number;
  selectedNativeScriptCases: number;
  nativeCaseInvocations: number;
  fixtures: { id: string; operations: (ScanFact | { operation: "index"; value: number })[] }[];
}

const cohort: Cohort = JSON.parse(readFileSync(new URL("./evidence/scanner-facts.json", import.meta.url), "utf8"));

test("pre-candidate archive and scanner projections retain exact native provenance", () => {
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const freeze: { paths: Record<string, string> } = JSON.parse(readFileSync(new URL("./evidence/freeze.json", import.meta.url), "utf8"));
  for (const [name, expected] of Object.entries(freeze.paths)) assert.equal(hash(readFileSync(new URL(name, import.meta.url))), expected, name);
  const archive: { originalManifestSHA256: string; files: Record<string, { base64: string; bytes: number; sha256: string }> } = JSON.parse(readFileSync(new URL("./evidence/design-v1/archive.json", import.meta.url), "utf8"));
  const original: Record<string, string> = JSON.parse(Buffer.from(archive.files["SHA256SUMS.json"]!.base64, "base64").toString());
  assert.deepEqual(Object.keys(archive.files).sort(), [...Object.keys(original), "SHA256SUMS.json"].sort());
  for (const [name, file] of Object.entries(archive.files)) {
    const bytes = Buffer.from(file.base64, "base64");
    assert.equal(bytes.length, file.bytes, name);
    assert.equal(hash(bytes), file.sha256, name);
    assert.equal(hash(bytes), name === "SHA256SUMS.json" ? archive.originalManifestSHA256 : original[name], name);
  }
  let observations = 0;
  const selectedCases = new Set<string>();
  for (const fixture of cohort.fixtures) for (const operation of fixture.operations) {
    if (operation.operation !== "scan") continue;
    observations++;
    selectedCases.add(operation.source.caseId);
    const raw: { profile: string; id: string; stdout: string }[] = JSON.parse(Buffer.from(archive.files[operation.source.rawFile]!.base64, "base64").toString());
    const row = raw.find(row => row.profile === operation.source.profile && row.id === operation.source.caseId);
    assert.ok(row?.stdout.split("\n").includes(operation.source.line), fixture.id);
  }
  assert.equal(observations, 76);
  assert.equal(observations, cohort.projectedScanObservations);
  assert.equal(selectedCases.size, 17);
  assert.equal(cohort.nativeCaseInvocations, 124);
});

for (const fixture of cohort.fixtures) {
  test(`frozen Bash5.3 scanner projection: ${fixture.id}`, async () => {
    let state = createGetoptsState();
    for (const operation of fixture.operations) {
      if (operation.operation === "index") {
        state = withGetoptsIndex(state, operation.value);
        continue;
      }
      const result = await scanGetopts(state, operation.optstring, operation.args, options({}, operation.reportErrors));
      assert.deepEqual(view(result), operation.expected, operation.source.line);
      state = result.state;
    }
  });
}
