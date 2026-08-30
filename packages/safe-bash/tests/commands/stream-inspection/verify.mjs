import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function hashes(directory) {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? Object.entries(hashes(path)) : [[path, createHash("sha256").update(readFileSync(path)).digest("hex")]];
  }).sort(([left], [right]) => left.localeCompare(right)));
}

function state() {
  return {
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
    sourceHashes: hashes("src"),
    authorCodeHashes: Object.fromEntries(Object.entries(hashes("tests/commands/stream-inspection")).filter(([path]) => /\.(?:ts|mjs)$/u.test(path))),
  };
}

function run(command, args, environment = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...environment } });
  return { command, args, environment, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
}

const before = state();
const tests = readdirSync("tests/commands/stream-inspection").filter(name => name.endsWith(".test.ts")).sort().map(name => `tests/commands/stream-inspection/${name}`);
const types = readdirSync("tests/commands/stream-inspection").filter(name => name.endsWith(".ts")).sort().map(name => `tests/commands/stream-inspection/${name}`);
const checks = [
  run("node_modules/.bin/tsc", ["--noEmit", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "src/commands/stream-inspection/index.ts", ...types]),
  run(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...tests], { STREAM_NATIVE_LIVE: "1" }),
  run("git", ["diff", "--check", "--", "src/commands/stream-inspection", "tests/commands/stream-inspection"]),
];
const after = state();
const changedSourcePaths = Object.keys({ ...before.sourceHashes, ...after.sourceHashes }).filter(path => before.sourceHashes[path] !== after.sourceHashes[path]);
const changedAuthorCodePaths = Object.keys({ ...before.authorCodeHashes, ...after.authorCodeHashes }).filter(path => before.authorCodeHashes[path] !== after.authorCodeHashes[path]);
const report = { authorOnly: true, independentDenominator: 0, frozenBeforeIndependentExposure: true, before, checks, after, changedSourcePaths, changedAuthorCodePaths, passed: checks.every(check => check.status === 0) && changedSourcePaths.length === 0 && changedAuthorCodePaths.length === 0 };
const content = JSON.stringify(report, null, 2) + "\n";
execFileSync("apply_patch", [], { input: "*** Begin Patch\n*** Add File: tests/commands/stream-inspection/evidence/author-validation.json\n" + content.split("\n").slice(0, -1).map(line => "+" + line).join("\n") + "\n*** End Patch\n", stdio: ["pipe", "inherit", "inherit"] });
console.log(JSON.stringify({ passed: report.passed, checks: checks.map(check => ({ command: check.command, status: check.status, stderr: check.stderr })), changedSourcePaths, changedAuthorCodePaths }));
if (!report.passed) process.exitCode = 1;
