import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const owned = "tests/commands/diff-patch/pruning-consumer";
const manifest = JSON.parse(readFileSync(`${owned}/original70.json`, "utf8"));
const evidence = mkdtempSync("/tmp/safe-bash-diff-rmdir-consumer-run-");
const hash = value => createHash("sha256").update(value).digest("hex");
function filesBelow(path) {
  if (!lstatSync(path).isDirectory()) return [path];
  return readdirSync(path).sort().filter(name => !name.startsWith(".")).flatMap(name => filesBelow(join(path, name)));
}
function originals() {
  for (const [path, expected] of Object.entries(manifest.originalFiles)) assert.equal(hash(readFileSync(path)), expected, `Frozen original changed: ${path}`);
  const discovered = ["tests/commands/diff-patch", "tests/commands/diff-patch-stress"].flatMap(filesBelow).filter(path => path.endsWith(".test.ts")).sort();
  assert.deepEqual(discovered, Object.keys(manifest.originalFiles).sort(), "Original3758 discovery must remain the same 70 files");
  return { testFiles: discovered.length, hashesUnchanged: true, rerun: false };
}
const roots = ["src/commands/diff-patch", "src/contracts", "src/fs/memory", owned,
  "tests/commands/diff-patch/helpers.ts", "tests/commands/diff-patch-stress/gnu-target/oracle.ts",
  "package.json", "package-lock.json", "tsconfig.json"];
const inventory = () => Object.fromEntries(roots.flatMap(filesBelow).sort().map(path => [path, hash(readFileSync(path))]));
const startedAt = new Date().toISOString();
const originalBefore = originals();
const inputsBefore = inventory();
const commands = [
  { name: "types", argv: ["node_modules/typescript/bin/tsc", "--noEmit", "-p", `${owned}/tsconfig.json`] },
  { name: "consumer", argv: ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", `${owned}/consumer.acceptance.ts`] },
];
const results = commands.map(({ name, argv }) => {
  const result = spawnSync(process.execPath, argv, { encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(evidence, `${name}.stdout`), result.stdout ?? "");
  writeFileSync(join(evidence, `${name}.stderr`), result.stderr ?? "");
  const count = key => Number([...result.stdout.matchAll(new RegExp(`^# ${key} (\\d+)$`, "gmu"))].at(-1)?.[1] ?? -1);
  return { name, argv: [process.execPath, ...argv], status: result.status, signal: result.signal, error: result.error?.message,
    counts: name === "consumer" ? Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, count(key)])) : undefined,
    stdoutSha256: hash(result.stdout ?? ""), stderrSha256: hash(result.stderr ?? "") };
});
const inputsAfter = inventory();
const originalAfter = originals();
const stable = JSON.stringify(inputsBefore) === JSON.stringify(inputsAfter);
const summary = { evidence, startedAt, finishedAt: new Date().toISOString(), node: process.version, results, stable,
  originalBefore, originalAfter, original3758: manifest.original3758, original30: manifest.original30, inputsBefore, inputsAfter };
writeFileSync(join(evidence, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ evidence, results, stable, originalAfter }, null, 2));
assert(stable, "Inputs changed during proof: repeat after the backend/source checkpoint stabilizes");
for (const result of results) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
}
assert.deepEqual(results[1].counts, { tests: 61, pass: 61, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
