import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { globSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, "../../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const list = pattern => globSync(pattern, { cwd: root }).sort();
const run = (command, args, timeoutMs = 120_000) => {
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  return { argv: [command, ...args], timeoutMs, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
};
const git = args => { const result = run("git", args); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const protectedPaths = [
  "tests/commands/column/cases.json", "tests/commands/column/native.json", "tests/commands/column/qualifications.json",
  "tests/commands/column/author-corrections.json", "tests/commands/column/author-verification.json", "tests/commands/column/AUTHOR_HANDOFF.md",
  "tests/commands/column-stress/provenance.json", "tests/commands/column-stress/recipes.json", "tests/commands/column-stress/native-observations.json",
];
const inherited = Object.fromEntries(protectedPaths.map(path => [path, hash(readFileSync(join(root, path)))]));
for (const path of protectedPaths) {
  const original = spawnSync("git", ["show", `38cb670a:${path}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(original.status, 0);
  assert.equal(hash(original.stdout), inherited[path], `Historical input changed: ${path}`);
}
mkdirSync(join(directory, "captures"), { recursive: true });
const output = mkdtempSync(join(directory, "captures/verify-"));
const outputRelative = relative(root, output);
const enumerate = () => [...new Set([
  ...list("src/**/*.ts"), ...list("src/commands/column/*.md"),
  ...list("tests/commands/column/**/*.ts"), ...list("tests/commands/column/**/*.mjs"),
  ...list("tests/commands/column/**/*.json").filter(path => !path.startsWith(`${outputRelative}/`)),
  ...list("tests/commands/column/padding-evolution/*.md"),
  ...protectedPaths, "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json",
])].sort();
const snapshot = paths => Object.fromEntries(paths.map(path => [path, hash(readFileSync(join(root, path)))]));
const beforePaths = enumerate(), before = snapshot(beforePaths), beforeHead = git(["rev-parse", "HEAD"]);
const checks = [
  run(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", ...list("tests/commands/column/**/*.test.ts")]),
  run("node_modules/.bin/tsc", ["--noEmit", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", ...list("tests/commands/column/**/*.ts")]),
  run("npm", ["run", "build"]),
  run(process.execPath, ["--input-type=module", "-e", "import assert from 'node:assert/strict'; import { createColumnCommand } from './dist/commands/column/index.js'; import { createMemoryFileSystem } from './dist/fs/memory/index.js'; import { toByteSource } from './dist/contracts/index.js'; const output=[]; const result=await createColumnCommand().execute({command:'column',args:['-t','-s',',:'],cwd:'/',env:{},fs:createMemoryFileSystem(),signal:new AbortController().signal,stdin:toByteSource('a,b:c\\nd::e,\\n'),stdout:{async write(bytes){output.push(Uint8Array.from(bytes));}},stderr:{async write(){throw new Error('unexpected diagnostic');}}}); assert.equal(result.exitCode,0); assert.equal(Buffer.concat(output).toString(),'a  b  c  \\nd     e  \\n'); console.log('Built internal ESM N03 smoke passed; not a packed-public-consumer gate.');"]),
  ...["empty", "combining", "explicit", "output-admission", "work-admission"].map(mode => run(process.execPath, ["--max-old-space-size=128", "--import", "tsx", "tests/commands/column/padding-evolution/sparse-child.mjs", mode], 15_000)),
  run("git", ["diff", "--check", "--", "src/commands/column", "tests/commands/column"]),
];
const afterPaths = enumerate(), after = snapshot(afterPaths);
const changed = [...new Set([...beforePaths, ...afterPaths])].filter(path => before[path] !== after[path]);
const ownedSource = Object.fromEntries(Object.entries(before).filter(([path]) => path.startsWith("src/commands/column/") && path.endsWith(".ts")));
const result = {
  classification: "Live-input author check with before/after immutable hashes during execution; not a committed-archive gate, full gate or independent-verifier acceptance",
  capturedAt: new Date().toISOString(), node: process.version, beforeHead, afterHead: git(["rev-parse", "HEAD"]),
  previousVerifierSourceTree: "014da3de0ca297c4e28bc410f908e94478edd40d",
  sourceDirtyDuringCheck: true, ownedSource, sourceDigest: hash(JSON.stringify(ownedSource)),
  sourceAndInputSnapshot: before, changedDuringChecks: changed,
  appendCheck: "Re-enumerates all src TypeScript and all owned column TypeScript/MJS/JSON inputs plus selected docs after checks: detects new/deleted names in those patterns, not only modifications of original paths. Only this exact generated JSON-output directory is excluded from JSON input audit; TypeScript/MJS there would still be audited. Not an append-proof whole-repository claim.",
  historicalProtectedHashes: inherited,
  evidenceScope: "No fresh column-stress verifier holdouts read/run; only explicit old provenance/recipes/native observations read and compared to 38cb670a. Old 37/40 remains historical. All owned TypeScript tests/helpers included; captured JSON is data, not reclassified TypeScript.",
  checks,
};
writeFileSync(join(output, "verification.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ output: relative(root, output), sourceDigest: result.sourceDigest, tests: checks[0].stdout.split("\n").filter(line => /^# (tests|pass|fail|cancelled|skipped|todo)/.test(line)), statuses: checks.map(check => check.status), changed }, null, 2));
if (checks.some(check => check.status !== 0) || changed.length) process.exitCode = 1;
