import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { sourceManifest } from "./numeric-syntax-oracle.ts";

const destination = process.argv[2];
assert.match(destination ?? "", /^tests\/commands\/stream-inspection\/evidence\/fixer-validation-[a-z0-9-]+\.json$/u);
assert.equal(existsSync(destination), false, "never overwrite previous evidence");
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
function state() {
  return {
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
    source: sourceManifest(),
    boundaryHashes: Object.fromEntries(["src/index.ts", "package.json", "src/commands/index.ts", "src/commands/stream-inspection/index.ts", "src/commands/stream-inspection/shared.ts", "src/commands/stream-inspection/README.md"].map(path => [path, hash(path)])),
    testHashes: Object.fromEntries(readdirSync("tests/commands/stream-inspection").filter(name => /\.(?:ts|mjs)$/u.test(name)).sort().map(name => {
      const path = `tests/commands/stream-inspection/${name}`;
      return [path, hash(path)];
    })),
  };
}
function run(command, args) {
  const started = new Date().toISOString();
  const environment = { STREAM_NATIVE_LIVE: "1", LC_ALL: "C", LANG: "C", TZ: "UTC" };
  const result = spawnSync(command, args, { encoding: "utf8", env: { ...process.env, ...environment }, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  return { command, args, environment, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
}
const before = state();
const root = "tests/commands/stream-inspection";
const types = readdirSync(root).filter(name => name.endsWith(".ts")).sort().map(name => `${root}/${name}`);
const authorTests = ["contracts", "integration", "native", "gnu-strings"].map(name => `${root}/${name}.test.ts`);
const checks = [
  run("node_modules/.bin/tsc", ["--noEmit", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "src/commands/stream-inspection/index.ts", ...types]),
  run(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", `${root}/numeric-syntax.test.ts`]),
  run(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...authorTests]),
  run("git", ["diff", "--check", "--", "src/commands/stream-inspection", root]),
];
const after = state();
const sourceStable = JSON.stringify(before.source) === JSON.stringify(after.source);
const boundariesStable = JSON.stringify(before.boundaryHashes) === JSON.stringify(after.boundaryHashes);
const testsStable = JSON.stringify(before.testHashes) === JSON.stringify(after.testHashes);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const runtimeDependencies = packageJson.dependencies ?? {};
const report = { role: "new source fixer; not independent acceptance", profile: { platform: platform(), release: release(), arch: arch(), node: process.version }, before, checks, after, sourceStable, boundariesStable, testsStable, runtimeDependencies, passed: checks.every(check => check.status === 0) && sourceStable && boundariesStable && testsStable && Object.keys(runtimeDependencies).length === 0 };
execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${destination}\n` + JSON.stringify(report, null, 2).split("\n").map(line => "+" + line).join("\n") + "\n*** End Patch\n" });
console.log(JSON.stringify({ passed: report.passed, source: after.source.sha256, checks: checks.map(check => ({ command: check.command, status: check.status, stderr: check.stderr, summary: check.stdout.slice(-200) })) }, null, 2));
if (!report.passed) process.exitCode = 1;
