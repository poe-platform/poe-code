import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fixtures } from "./fixtures.js";
import { directory, probe, sourceHashes, verify } from "./helpers.js";
import { oracleIdentity } from "../gnu-target/oracle.js";

const startedAt = new Date().toISOString();
const before = await sourceHashes();
const observations = [];
for (const fixture of fixtures) {
  const observation = await probe(fixture);
  let failure: string | undefined;
  try { verify(fixture, observation); } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  observations.push({ ...observation, pass: failure === undefined, ...(failure === undefined ? {} : { failure }) });
  console.log(`${failure === undefined ? "PASS" : "FAIL"} ${fixture.name}: GNU=${observation.native.exitCode} VFS=${observation.virtual.exitCode} ${observation.virtual.stderr.trim()}`);
}
const after = await sourceHashes();
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
const report = { startedAt, finishedAt: new Date().toISOString(), oracle: oracleIdentity("patch"), sources: { before, after, changed }, observations };
const suffix = process.argv[2] ?? "checkpoint-1";
assert.match(suffix, /^checkpoint-[1-9][0-9]*$/u);
const path = `${directory}evidence-${suffix}.json`;
assert(!existsSync(path), "historical evidence must not be overwritten; choose a new checkpoint number");
const content = JSON.stringify(report, null, 2);
const result = spawnSync("apply_patch", [`*** Begin Patch\n*** Add File: ${path}\n${content.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`], { encoding: "utf8", maxBuffer: 65_536, timeout: 5000 });
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
console.log(result.stdout.trim());
console.log(JSON.stringify({ total: observations.length, pass: observations.filter(item => item.pass).length, changed }, null, 2));
