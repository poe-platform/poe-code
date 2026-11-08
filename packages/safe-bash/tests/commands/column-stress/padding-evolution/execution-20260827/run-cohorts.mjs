import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { globSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [candidate, destination] = process.argv.slice(2);
assert(candidate && destination);
const directory = fileURLToPath(new URL(".", import.meta.url));
const runner = join(directory, "runner.mjs"), worker = join(directory, "cases.mjs");
const commands = [];
const hashes = Object.fromEntries(await Promise.all([runner, worker, fileURLToPath(import.meta.url)].map(async (path) => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
await writeFile(join(destination, "cohort-inputs.json"), JSON.stringify({ candidate, harnessHashesBefore: hashes, authorTestFiles: globSync("tests/commands/column/**/*.test.ts", { cwd: candidate }).sort(), authorTypeFiles: globSync("tests/commands/column/**/*.ts", { cwd: candidate }).sort() }, null, 2) + "\n", { flag: "wx" });
async function execute(name, timeout, cap, args) {
  const output = join(destination, `${name}-process.json`);
  const child = spawn(process.execPath, [runner, output, candidate, String(timeout), String(cap), process.execPath, ...args], { stdio: "inherit" });
  const exit = await new Promise((resolve) => child.once("close", (status, signal) => resolve({ status, signal })));
  commands.push({ name, ...exit, output });
  return JSON.parse(await readFile(output));
}
for (const [name, script, cause] of [
  ["negative-hang", "setInterval(()=>{},1000)", "deadline"],
  ["negative-output-flood", "process.stdout.write(Buffer.alloc(131072));setInterval(()=>{},1000)", "stdout-cap"],
  ["negative-worker-leak", "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(child.pid));process.exit(0)", "surviving-process-group"],
]) {
  const result = await execute(name, name === "negative-hang" ? 150 : 2000, 65536, ["-e", script]);
  assert.equal(result.termination, cause); assert.equal(result.groupAliveAfterRetirement, false); assert.equal(commands.at(-1).status, 1);
}
await execute("author148", 120000, 8388608, ["--import", "tsx", "--test", "--test-concurrency=1", ...globSync("tests/commands/column/**/*.test.ts", { cwd: candidate }).sort()]);
await execute("owned-six-regressions", 30000, 8388608, ["--import", "tsx", "--test", "tests/commands/column-stress/owned-regressions.test.ts"]);
await execute("scoped-types", 120000, 8388608, ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--types", "node", ...globSync("tests/commands/column/**/*.ts", { cwd: candidate }).sort(), "tests/commands/column-stress/owned-regressions.test.ts"]);
await execute("unchanged-old40", 120000, 8388608, ["--max-old-space-size=128", join(candidate, "tests/commands/column-stress/handoff-20260827/stress.mjs"), candidate, join(destination, "unchanged-old40.json")]);
for (const group of ["literals", ...Array.from({ length: 16 }, (_, index) => `E${String(index + 1).padStart(2, "0")}`), "supplemental"]) {
  await execute(group, 5000, 65536, ["--max-old-space-size=128", worker, candidate, join(destination, `${group}.json`), group]);
}
await execute("negative-wrong-padding", 5000, 65536, ["--max-old-space-size=128", worker, candidate, join(destination, "negative-wrong-padding.json"), "literals", "wrong-padding"]);
await execute("negative-no-output-admission", 5000, 65536, ["--max-old-space-size=128", worker, candidate, join(destination, "negative-no-output-admission.json"), "E02", "no-output-admission"]);
for (const [path, before] of Object.entries(hashes)) assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), before);
await writeFile(join(destination, "cohort-commands.json"), JSON.stringify({ commands, harnessHashesAfter: hashes }, null, 2) + "\n", { flag: "wx" });
