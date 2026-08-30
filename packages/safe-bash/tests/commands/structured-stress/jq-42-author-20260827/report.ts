import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { allVectors, executeVector, expectedBytes, type BytesResult, type Vector } from "../independent-increment/harness.js";
import { additiveVectors } from "../independent-increment/phase2-harness.js";

const directory = "tests/commands/structured-stress/jq-42-author-20260827";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const frozenPath = "benchmarks/reports/current-integration/jq-delta-classification.json";
const frozen = spawnSync("git", ["show", `96db59ac:${frozenPath}`], { encoding: "utf8" });
assert.equal(frozen.status, 0);
assert.equal(readFileSync(frozenPath, "utf8"), frozen.stdout);
const groups = JSON.parse(frozen.stdout) as Record<string, { name: string }[]>;
const original = new Set(Object.values(groups).flat().map(value => value.name.replace(/^(additive )?native exact bytes: /u, "")));
assert.equal(original.size, 42);
const sourceHashes = Object.fromEntries(readdirSync("src/commands/structured").sort().map(name => [name, hash(readFileSync(`src/commands/structured/${name}`))]));
const results: ({ [Field in "id" | "argv" | "inputHex" | "files" | "stages"]: Vector[Field] } & { original42: boolean; cohort: string; expected: BytesResult; actual: BytesResult; pass: boolean })[] = [];
for (const vector of [...allVectors, ...additiveVectors]) {
  const actual = await executeVector(vector);
  const expected = expectedBytes(vector);
  results.push({ id: vector.id, original42: original.has(vector.id), cohort: allVectors.includes(vector) ? "independent" : "additive", argv: vector.argv, inputHex: vector.inputHex, files: vector.files, stages: vector.stages, expected, actual, pass: JSON.stringify(actual) === JSON.stringify(expected) });
}
const summarize = (values: typeof results) => ({ total: values.length, pass: values.filter(value => value.pass).length, fail: values.filter(value => !value.pass).length });
const report = { date: new Date().toISOString(), head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(), status: spawnSync("git", ["status", "--short"], { encoding: "utf8" }).stdout, sourceHashes, original42: summarize(results.filter(value => value.original42)), independent: summarize(results.filter(value => value.cohort === "independent")), additive: summarize(results.filter(value => value.cohort === "additive")), results };
const name = process.argv[2];
assert.match(name ?? "", /^[a-z-]+$/u);
const path = `${directory}/${name}.json`;
assert.equal(existsSync(path), false);
const content = JSON.stringify(report, null, 2) + "\n";
const patch = `*** Begin Patch\n*** Add File: ${path}\n${content.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
assert.equal(spawnSync("apply_patch", [], { input: patch, encoding: "utf8", maxBuffer: 1024 * 1024 }).status, 0);
console.log(JSON.stringify({ original42: report.original42, independent: report.independent, additive: report.additive }));
for (const result of results.filter(value => !value.pass)) console.log(result.id, result.actual);
