import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";

async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result.sort();
}

async function hashes(paths: readonly string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
}

const scope = "tests/commands/diff-patch-stress/pruning-adversarial";
const output = process.argv[2] ?? `${scope}/evidence.json`;
const exploratory = process.argv.includes("--exploratory");
const outsideContract = process.argv.includes("--outside-contract");
const consumer = "src/commands/diff-patch/patch-gnu-paths.ts";
if (!exploratory) assert.equal(execFileSync("git", ["status", "--porcelain", "--", "src"], { encoding: "utf8" }).trim(), "", "final proof requires committed source or rerun after owners finish");
const watchdog = setTimeout(() => { console.error("Acceptance runner exceeded its 120-second hard deadline"); process.exit(124); }, 120000);
const sourcePaths = [...await files("src"), "tests/fs/webdav/mock.ts"];
async function originalFiles(): Promise<string[]> {
  return [...await files("tests/commands/diff-patch"), ...await files("tests/commands/diff-patch-stress")].filter(path => path.endsWith(".test.ts")).sort();
}
const originalPaths = await originalFiles();
assert.equal(originalPaths.length, 70, "frozen original70 test-file discovery");
const originalReference = "4d4f5ca";
const referencePaths = execFileSync("git", ["ls-tree", "-r", "--name-only", originalReference, "--", "tests/commands/diff-patch", "tests/commands/diff-patch-stress"], { encoding: "utf8" }).trim().split("\n").filter(path => path.endsWith(".test.ts")).sort();
assert.deepEqual(originalPaths, referencePaths);
const before = await hashes(sourcePaths);
const originalBefore = await hashes(originalPaths);
const originalReferenceHashes = Object.fromEntries(originalPaths.map(path => [path, createHash("sha256").update(execFileSync("git", ["show", `${originalReference}:${path}`])).digest("hex")]));
assert.deepEqual(originalBefore, originalReferenceHashes, "original70 unchanged from independent Git reference");
const fixturesBefore = await hashes((await files(scope)).filter(path => path.endsWith(".ts")));
assert.ok((await files(scope)).every(path => !path.endsWith(".js") && !path.endsWith(".test.ts")), "no emitted JS siblings or default-test additions");
const { cases, runCase, capabilityCases } = await import("./pruning.acceptance.js");
const results = outsideContract ? [] : await capabilityCases();
for (const spec of cases(outsideContract)) {
  const evidence = await runCase(spec);
  results.push(evidence);
  if (!evidence.passed) console.error(`FAIL ${JSON.stringify(spec)}\n${evidence.failure}`);
}
const after = await hashes([...await files("src"), "tests/fs/webdav/mock.ts"]);
const originalAfter = await hashes(await originalFiles());
const fixturesAfter = await hashes((await files(scope)).filter(path => path.endsWith(".ts")));
const sourceStable = JSON.stringify(before) === JSON.stringify(after);
const originalsStable = JSON.stringify(originalBefore) === JSON.stringify(originalAfter);
const fixturesStable = JSON.stringify(fixturesBefore) === JSON.stringify(fixturesAfter);
const summary: Record<string, { passed: number; failed: number }> = {};
for (const evidence of results) {
  const name = `${evidence.case.backend}/${evidence.classification.startsWith("direct") ? "capability" : evidence.case.action}`;
  const count = summary[name] ??= { passed: 0, failed: 0 };
  count[evidence.passed ? "passed" : "failed"]++;
}
const report = {
  timestamp: new Date().toISOString(), exploratory, outsideContract, node: process.version,
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  consumerCommit: execFileSync("git", ["log", "-1", "--format=%H", "--", consumer], { encoding: "utf8" }).trim(),
  sourceStable, originalsStable, fixturesStable, sourceBefore: before, sourceAfter: after,
  fixtureHashes: fixturesBefore, originalReference, originalTestHashes: originalBefore,
  passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length,
  summary, results,
};
await writeFile(output, `${JSON.stringify(report)}\n`);
clearTimeout(watchdog);
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, sourceStable, originalsStable, fixturesStable, summary }, null, 2));
if (report.failed || !sourceStable || !originalsStable || !fixturesStable) process.exitCode = 1;
