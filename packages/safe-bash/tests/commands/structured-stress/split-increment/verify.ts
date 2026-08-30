import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = "tests/commands/structured-stress/split-increment";
assert.ok(!(process.argv.includes("--freeze") && process.argv.includes("--delivery")), "choose one new artifact");
const destination = `${root}${directory}/${process.argv.includes("--delivery") ? "delivery" : "baseline"}.json`;
const hash = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const gitHead = (): string => {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, shell: false, timeout: 2000, maxBuffer: 4096, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  return result.stdout.trim();
};
const matrixFiles = ["README.md", "fixtures.ts", "matrix.test.ts"].map(name => `tests/integration/adapter-tools/${name}`);
const matrixHashes = (): Record<string, string> => Object.fromEntries(matrixFiles.map(path => [path, hash(readFileSync(`${root}${path}`))]));
const frozenFiles = [
  `${directory}/native.json`, `${directory}/baseline.json`,
  ...["native-vectors", "supplement-vectors", "phase1-observation", "supplement-observation"].map(name => `tests/commands/structured-stress/independent-increment/${name}.json`),
].filter(path => existsSync(`${root}${path}`));
const frozenHashes = (): Record<string, string> => Object.fromEntries(frozenFiles.map(path => [path, hash(readFileSync(`${root}${path}`))]));
const sourceFiles = readdirSync(`${root}src/commands/structured`).filter(name => name.endsWith(".ts")).map(name => `src/commands/structured/${name}`);
const sourceHashes = (): Record<string, string> => Object.fromEntries(sourceFiles.map(path => [path, hash(readFileSync(`${root}${path}`))]));
const before = { head: gitHead(), matrix: matrixHashes(), frozen: frozenHashes(), source: sourceHashes() };
const startedAt = new Date().toISOString();
const results = [];
for (const [name, paths] of [
  ["helper", [`${directory}/helper.test.ts`]],
  ["command", [`${directory}/command.test.ts`]],
  ["interop", [`${directory}/interop.test.ts`]],
  ["live-matrix", ["tests/integration/adapter-tools/matrix.test.ts"]],
] as const) {
  const argv = ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-reporter=tap", ...paths];
  const result = spawnSync(process.execPath, argv, { cwd: root, shell: false, timeout: 60000, killSignal: "SIGKILL", maxBuffer: 512 * 1024, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const totals = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1]!, Number(match[2])]));
  const failures = result.stdout.split("\n").filter(line => line.startsWith("not ok "));
  const row = { name, argv, status: result.status, totals, failures, stdoutSha256: hash(result.stdout), stderr: result.stderr, stdout: result.stdout };
  results.push(row);
  console.log(JSON.stringify({ name, status: result.status, totals, failures }, null, 2));
}
const after = { head: gitHead(), matrix: matrixHashes(), frozen: frozenHashes(), source: sourceHashes() };
assert.deepEqual(after.matrix, before.matrix, "integration fixtures changed during verification");
assert.deepEqual(after.frozen, before.frozen, "frozen native evidence or baseline changed during verification");
assert.deepEqual(after.source, before.source, "structured source changed during verification");
if (process.argv.includes("--freeze") || process.argv.includes("--delivery")) {
  assert.equal(existsSync(destination), false, "do not overwrite an existing verification artifact");
  const evidence = { startedAt, completedAt: new Date().toISOString(), node: process.version, executable: process.execPath, before, after, timeoutMsPerSuite: 60000, maxBufferBytes: 524288, results };
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${destination}\n${text.split("\n").slice(0, -1).map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
  const applied = spawnSync("apply_patch", [patch], { cwd: root, shell: false, timeout: 5000, maxBuffer: 65536, encoding: "utf8" });
  assert.ifError(applied.error);
  assert.equal(applied.status, 0, applied.stderr);
  console.log(`Frozen verification artifact ${destination} SHA-256 ${hash(text)}`);
}
process.exitCode = results.some(result => result.status !== 0) ? 1 : 0;
