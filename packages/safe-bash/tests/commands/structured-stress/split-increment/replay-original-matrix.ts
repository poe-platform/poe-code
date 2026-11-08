import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const revision = "6a259ff4c38f64efb506e39812166ff7f003f6ce";
const matrixPath = "tests/integration/adapter-tools/matrix.test.ts";
const fixturesPath = "tests/integration/adapter-tools/fixtures.ts";
const destination = `${root}tests/commands/structured-stress/split-increment/original-matrix.json`;
const hash = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const git = (...args: string[]): string => {
  const result = spawnSync("git", args, { cwd: root, shell: false, timeout: 2000, maxBuffer: 128 * 1024, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const original = git("show", `${revision}:${matrixPath}`);
assert.equal(hash(original), "e959e6c77016674f438a2daa4fc76cac2a73b1daa8a91ae43052563bc53d99df");
const originalFixtures = git("show", `${revision}:${fixturesPath}`);
const fixturesHash = hash(originalFixtures);
assert.equal(fixturesHash, "955fc83173aea8297653a1015e40c41cf0bc471a9268fa159293167f6b0c9059");
const snapshot = () => ({ head: git("rev-parse", "HEAD").trim(), liveMatrixHash: hash(readFileSync(`${root}${matrixPath}`)), liveFixturesHash: hash(readFileSync(`${root}${fixturesPath}`)) });
const before = snapshot();
const relocate = (source: string, replacements: ReadonlyMap<string, string>): string => {
  let relocated = source;
  for (const [specifier, replacement] of replacements) {
    assert.equal(relocated.split(specifier).length, 2, "only an explicit module location is rebased");
    relocated = relocated.replace(specifier, replacement);
  }
  let restored = relocated;
  for (const [specifier, replacement] of replacements) restored = restored.replace(replacement, specifier);
  assert.equal(restored, source, "all frozen assertions and fixture behavior remain unchanged");
  return relocated;
};
const productUrl = JSON.stringify(new URL("../../../../src/index.ts", import.meta.url).href);
const fixtureSource = relocate(originalFixtures, new Map([
  ['"../../../src/index.js"', productUrl],
  ['"../../fs/webdav/mock.js"', JSON.stringify(new URL("../../../fs/webdav/mock.ts", import.meta.url).href)],
  ["import.meta.url", JSON.stringify(new URL("../../../integration/adapter-tools/fixtures.ts", import.meta.url).href)],
]));
const fixtureModule = ts.transpileModule(fixtureSource, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const relocated = relocate(original, new Map([
  ['"../../../src/index.js"', productUrl],
  ['"./fixtures.js"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(fixtureModule).toString("base64")}`)],
]));
const compiled = ts.transpileModule(relocated, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } });
const argv = ["--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "--eval", compiled.outputText];
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, argv, { cwd: root, shell: false, timeout: 60000, killSignal: "SIGKILL", maxBuffer: 512 * 1024, encoding: "utf8" });
assert.ifError(result.error);
assert.equal(result.signal, null);
const after = snapshot();
assert.equal(after.liveMatrixHash, before.liveMatrixHash);
assert.equal(after.liveFixturesHash, before.liveFixturesHash);
const totals = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1]!, Number(match[2])]));
assert.equal(totals.tests, 79, "every original test must execute");
const failures = result.stdout.split("\n").filter(line => line.startsWith("not ok "));
console.log(JSON.stringify({ revision, before, after, status: result.status, totals, failures }, null, 2));
if (process.argv.includes("--freeze")) {
  assert.equal(existsSync(destination), false, "do not overwrite original-matrix replay evidence");
  const text = `${JSON.stringify({ startedAt, completedAt: new Date().toISOString(), node: process.version, revision, originalMatrixHash: hash(original), fixturesHash, before, after, argv, status: result.status, totals, failures, stdout: result.stdout, stderr: result.stderr }, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${destination}\n${text.split("\n").slice(0, -1).map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
  const applied = spawnSync("apply_patch", [patch], { cwd: root, shell: false, timeout: 5000, maxBuffer: 65536, encoding: "utf8" });
  assert.ifError(applied.error);
  assert.equal(applied.status, 0, applied.stderr);
  console.log(`Frozen original-matrix replay SHA-256 ${hash(text)}`);
}
process.exitCode = result.status ?? 1;
