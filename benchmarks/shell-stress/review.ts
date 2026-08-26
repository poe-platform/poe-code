import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { bashVersion, root, sourceEvidence } from "../../tests/shell-stress/helpers.js";
import { isolatedSpawn } from "../../tests/shell-stress/process.js";

const before = sourceEvidence();
const entries = (directory: string) => readdirSync(join(root, directory)).filter(path => path.endsWith(".ts")).map(path => `${directory}/${path}`);
const sourcePaths = entries("src/shell");
const shellPaths = entries("tests/shell");
const harnessPaths = [...shellPaths, ...entries("tests/shell-stress"), ...entries("benchmarks/shell-stress")];
const hashes = () => Object.fromEntries(harnessPaths.map(path => [path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex")]));
const harnessBefore = hashes();
const shellCommand = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", ...shellPaths.filter(path => path.endsWith(".test.ts"))];
const totals = (output: string) => Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(new RegExp(`^# ${key} (\\d+)$`, "m").exec(output)?.[1] ?? NaN)]));
async function run(command: string, args: string[], timeout = 60000) {
  const started = new Date().toISOString();
  const result = await isolatedSpawn(command, args, { cwd: root, timeout, maxBuffer: 16 * 1024 * 1024 });
  return { command: [command, ...args], started, finished: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

const shell = await run(process.execPath, shellCommand);
const repetitions = [];
for (let iteration = 1; iteration <= 20; iteration++) {
  const result = await run(process.execPath, shellCommand);
  const { stdout, ...metadata } = result;
  repetitions.push({ iteration, ...metadata, totals: totals(stdout), ...(result.exitCode === 0 && !result.error ? {} : { stdout }) });
}
const oracle = await run(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "tests/shell/oracle.ts", "--strict"]);
const flags = ["--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node"];
const validations = [
  await run(process.execPath, ["node_modules/typescript/bin/tsc", ...flags, ...sourcePaths, ...harnessPaths]),
  await run("npm", ["run", "typecheck"]),
  await run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--noEmit"]),
  await run("npm", ["run", "build"]),
  await run(process.execPath, ["--input-type=module", "-e", 'import assert from "node:assert/strict"; import {Shell, MemoryFileSystem, CommandRegistry, createStandardCommands} from "./dist/index.js"; const shell = new Shell({fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands())}); try { const result = await shell.exec("printf built"); assert.equal(result.stdout, "built"); assert.equal(result.exitCode, 0); } finally { await shell.dispose(); }']),
];
const after = sourceEvidence();
const harnessAfter = hashes();
const report = {
  before, after, bash: bashVersion(), harnessBefore, harnessAfter,
  changedSources: [...new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])].filter(path => before.hashes[path] !== after.hashes[path]),
  changedHarness: harnessPaths.filter(path => harnessBefore[path] !== harnessAfter[path]),
  shell: { ...shell, totals: totals(shell.stdout) }, repetitions, oracle, validations,
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.changedSources.length === 0 && report.changedHarness.length === 0
  && [shell, ...repetitions, oracle, ...validations].every(result => result.exitCode === 0 && !result.error && !result.signal) ? 0 : 1;
