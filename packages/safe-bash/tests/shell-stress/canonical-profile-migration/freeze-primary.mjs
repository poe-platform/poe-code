import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { differentialCases, syntaxCases } from "../cases.ts";
import { additionalCases } from "../current-gaps/cases.ts";

const owned = "tests/shell-stress/canonical-profile-migration";
const output = `${owned}/primary-fixtures.json`;
assert.equal(existsSync(output), false);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const inputs = JSON.parse(readFileSync(`${owned}/inputs.json`));
const sourceFiles = Object.fromEntries(["tests/shell-stress/cases.ts", "tests/shell-stress/current-gaps/cases.ts"].map(path => {
  assert.equal(digest(readFileSync(path)), inputs.originals[path].sha256);
  return [path, inputs.originals[path].sha256];
}));
const captureSha256 = digest(readFileSync(`${owned}/native.json`));
assert.equal(captureSha256, "de379916112faa3cec68f3180b5ba55758eda415f2016456d448f635c9871bf5");
const fixtures = [["differential", differentialCases], ["syntax", syntaxCases], ["current-gaps", additionalCases]].flatMap(([cohort, rows]) => rows.map(fixture => ({ cohort, fixture })));
assert.equal(fixtures.length, 88);
assert.equal(new Set(fixtures.map(row => row.fixture.name)).size, 88);
const metadata = { sourceCommit: inputs.sourceCommit, nativeCaptureSha256: captureSha256, profile: "GNU5.3-primary", binarySha256: "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c", invocationName: "shell", sourceFiles, fixtures };
execFileSync("apply_patch", [`*** Begin Patch\n*** Add File: ${output}\n${JSON.stringify(metadata, null, 2).split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`], { stdio: "inherit" });
console.log(JSON.stringify({ output, sha256: digest(readFileSync(output)), fixtures: fixtures.length }));
