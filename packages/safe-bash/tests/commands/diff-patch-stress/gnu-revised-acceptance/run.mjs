import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repository = "/Users/kjopek/Workspace/safe-bash";
assert.equal(process.cwd(), repository);
const owned = "tests/commands/diff-patch-stress/gnu-revised-acceptance";
const evidence = mkdtempSync("/tmp/safe-bash-diff-revised-run-");
const hash = value => createHash("sha256").update(value).digest("hex");
const baseline = JSON.parse(readFileSync(`${owned}/original-manifest.json`));
function inventory(roots) {
  const files = {};
  function visit(path) {
    if (lstatSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (/^(?:\.native-|\.hunk-native-|patch-gnu-native-)/u.test(name)) continue;
        visit(join(path, name));
      }
    } else files[path] = hash(readFileSync(path));
  }
  for (const root of roots) visit(root);
  return files;
}
function verifyOriginals() {
  const originals = Object.entries(baseline.originalFiles).filter(([path]) => path.startsWith("tests/"));
  for (const [path, expected] of originals) assert.equal(hash(readFileSync(path)), expected, `Original changed: ${path}`);
  const discovered = Object.keys(inventory(["tests/commands/diff-patch", "tests/commands/diff-patch-stress"]))
    .filter(path => path.endsWith(".test.ts")).sort();
  assert.deepEqual(discovered, baseline.original3758.testFiles, "The original3758 discovery must remain exactly the same 70 files");
  return { originalFiles: originals.length, originalTestFiles: discovered.length, original3758Rerun: false };
}
const startedAt = new Date().toISOString();
const originalsBefore = verifyOriginals();
const inputsBefore = inventory(["src/commands/diff-patch", "src/contracts", "src/fs/memory", owned,
  "tests/commands/diff-patch-stress/safety/helpers.ts", "tests/commands/diff-patch-stress/gnu-target/oracle.ts", "package.json", "package-lock.json", "tsconfig.json"]);
const command = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", `${owned}/revised.acceptance.ts`];
const result = spawnSync(process.execPath, command, { cwd: repository, encoding: "utf8", timeout: 120_000,
  killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 });
writeFileSync(join(evidence, "revised.stdout"), result.stdout ?? "");
writeFileSync(join(evidence, "revised.stderr"), result.stderr ?? "");
const inputsAfter = inventory(["src/commands/diff-patch", "src/contracts", "src/fs/memory", owned,
  "tests/commands/diff-patch-stress/safety/helpers.ts", "tests/commands/diff-patch-stress/gnu-target/oracle.ts", "package.json", "package-lock.json", "tsconfig.json"]);
const originalsAfter = verifyOriginals();
const count = name => Number([...result.stdout.matchAll(new RegExp(`^# ${name} (\\d+)$`, "gmu"))].at(-1)?.[1] ?? -1);
const counts = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"].map(name => [name, count(name)]));
const stable = JSON.stringify(inputsBefore) === JSON.stringify(inputsAfter);
const summary = { evidence, startedAt, finishedAt: new Date().toISOString(), argv: [process.execPath, ...command],
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  exitCode: result.status, signal: result.signal, error: result.error?.message, counts, stable, originalsBefore, originalsAfter,
  inputsBefore, inputsAfter, stdoutSha256: hash(result.stdout), stderrSha256: hash(result.stderr),
  original3758: baseline.original3758, original30: baseline.original30 };
writeFileSync(join(evidence, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ evidence, exitCode: result.status, counts, stable, originalsAfter }));
assert.ifError(result.error);
assert.equal(result.signal, null);
assert(stable, "Input changed during revised acceptance; repeat, do not silently accept moving-tree output");
assert.deepEqual(counts, { tests: 96, pass: 96, fail: 0, skipped: 0, cancelled: 0, todo: 0 });
assert.equal(result.status, 0);
