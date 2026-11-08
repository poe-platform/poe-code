import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const list = pattern => globSync(pattern, { cwd: root }).sort();
const snapshot = paths => Object.fromEntries(paths.map(path => [path, hash(readFileSync(join(root, path)))]));
const paths = [
  ...list("src/**/*.ts"),
  ...list("src/commands/column/*.md"),
  ...list("tests/commands/column/*.ts"),
  ...list("tests/commands/column/*.mjs"),
  ...["cases.json", "native.json", "qualifications.json", "author-corrections.json"].map(name => `tests/commands/column/${name}`),
  "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json",
].sort();
const before = snapshot(paths);
const run = (command, args) => {
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  return { command: [command, ...args], started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
};
const git = args => {
  const result = run("git", args);
  assert.equal(result.status, 0);
  return result.stdout.trim();
};
const beforeHead = git(["rev-parse", "HEAD"]);
const checks = [
  run(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", ...list("tests/commands/column/*.test.ts")]),
  run(process.execPath, ["tests/commands/column/capture-native.mjs", "--verify"]),
  run("node_modules/.bin/tsc", ["--noEmit", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", ...list("tests/commands/column/*.ts")]),
  run("npm", ["run", "build"]),
  run(process.execPath, ["--input-type=module", "-e", "import assert from 'node:assert/strict'; import { createColumnCommand } from './dist/commands/column/index.js'; import { createMemoryFileSystem } from './dist/fs/memory/index.js'; import { toByteSource } from './dist/contracts/index.js'; const chunks=[]; const result=await createColumnCommand().execute({command:'column',args:['-t'],cwd:'/',env:{},fs:createMemoryFileSystem(),signal:new AbortController().signal,stdin:toByteSource('a b\\nlong z\\n'),stdout:{async write(bytes){chunks.push(Uint8Array.from(bytes));}},stderr:{async write(){throw new Error('unexpected diagnostic');}}}); assert.equal(result.exitCode,0); assert.equal(Buffer.concat(chunks).toString(),'a     b\\nlong  z\\n'); console.log('Direct built ESM module smoke passed; not a packed/public-subpath test.');"]),
  run("git", ["diff", "--check", "--", "src/commands/column", "tests/commands/column"]),
];
const after = snapshot(paths);
const changed = paths.filter(path => before[path] !== after[path]);
const ownedSourceHashes = Object.fromEntries(Object.entries(before).filter(([path]) => path.startsWith("src/commands/column/") && path.endsWith(".ts")));
const ownedSourceDigest = hash(JSON.stringify(ownedSourceHashes));
const evidence = {
  classification: "Scoped author candidate verification; uncommitted owned additions during execution; not a whole-repository gate or independent verifier acceptance",
  capturedAt: new Date().toISOString(), node: process.version,
  beforeHead, afterHead: git(["rev-parse", "HEAD"]),
  ownedSourceHashes, ownedSourceDigest,
  sourceSnapshot: before, changedDuringChecks: changed,
  inventoryPolicy: "All current src/**/*.ts inventoried; only column-owned canonical tests/helpers checked as test inputs. Native JSON and fixture JSON explicitly classified as data; no TypeScript fixture excluded or reclassified. Hash inventory does not certify other source behavior/tests/consumers.",
  nativeCohort: { total: 28, exact: 15, qualified: 9, nativeUnsupported: 2, productUnsupported: 2, originalMisclassifiedExact: 17 },
  knownLimits: ["Shell-owned external stdin hides original return; column cannot await it", "No root/public export integration or packed-consumer acceptance", "No util-linux executable oracle or full BSD/Unicode parity"],
  checks,
};
const output = join(directory, "author-verification.json");
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ output: relative(root, output), ownedSourceDigest, checks: checks.map(check => ({ command: check.command.slice(0, 3), status: check.status })), changedDuringChecks: changed }, null, 2));
if (checks.some(check => check.status !== 0) || changed.length) process.exitCode = 1;
