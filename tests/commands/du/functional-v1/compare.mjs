import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeCases } from "./native-cases.ts";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.ts";
import { createRealFileSystem } from "../../../../src/fs/real/index.ts";
import { seed, shellRun } from "../helpers.ts";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../../..");
const oracle = join(root, "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du");
const expectedHash = "f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b";
const hash = async path => createHash("sha256").update(await readFile(path)).digest("hex");
assert.equal(await hash(oracle), expectedHash);
const paths = ["src/commands/du/arguments.ts", "src/commands/du/du.ts", "src/commands/du/format.ts", "src/commands/du/budget.ts", "src/commands/du/options.ts", "src/commands/du/index.ts"];
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, await hash(join(root, path))])));
await mkdir(join(directory, "evidence"), { recursive: true });
const output = await mkdtemp(join(directory, "evidence/comparison-v1-"));
const fixture = await mkdtemp(join(directory, ".native-comparison-"));
const record = result => ({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr });
const agreement = (native, product) => ({ exactStatusStdout: native.status === product.status && native.stdout === product.stdout, exactAllFields: native.status === product.status && native.stdout === product.stdout && native.stderr === product.stderr });
try {
  await writeFile(join(fixture, "file"), new Uint8Array(1025));
  const real = await createRealFileSystem({ root: fixture });
  const results = [];
  for (const item of nativeCases) {
    const result = spawnSync(oracle, item.args, { cwd: fixture, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", ...item.env }, encoding: "utf8", timeout: 10000, maxBuffer: 65536 });
    assert.equal(result.error, undefined); assert.notEqual(result.status, null);
    const native = { status: result.status, stdout: result.stdout, stderr: result.stderr };
    const product = record(await shellRun(real, item.args, { ...item.env }));
    results.push({ ...item, native, product, ...agreement(native, product) });
  }
  const original = JSON.parse(await readFile(join(directory, "../native-profile.json"), "utf8"));
  const memory = createMemoryFileSystem(); await seed(memory); await memory.writeFile("/size-1025", new Uint8Array(1025));
  const originalSelected = [];
  for (const index of [59, 61, 85, 86]) {
    const native = original.results[index]; const product = record(await shellRun(memory, native.args, native.env));
    originalSelected.push({ id: `O${String(index + 1).padStart(3, "0")}`, native, product, ...agreement(native, product) });
  }
  const changedSources = [];
  for (const [path, expected] of Object.entries(sourceHashes)) if (await hash(join(root, path)) !== expected) changedSources.push(path);
  assert.equal(await hash(oracle), expectedHash);
  const summary = { liveRealCases: results.length, exactStatusStdout: results.filter(result => result.exactStatusStdout).length, exactAllFields: results.filter(result => result.exactAllFields).length, selectedOriginalCases: originalSelected.length, originalSelectedExact: originalSelected.filter(result => result.exactAllFields).length };
  await writeFile(join(output, "results.json"), JSON.stringify({ qualification: "Scoped author GNU9.7/Darwin comparison; preserved explicit-B wording gaps and unchanged O060; no all-input acceptance", created: new Date().toISOString(), platform: process.platform, node: process.version, sourceHead: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), sourceHashes, changedSources, originalPathsOnly: true, binaryBeforeSha256: expectedHash, binaryAfterSha256: await hash(oracle), fixtureRoot: fixture, fixtureBytes: 1025, summary, results, originalSelected }, null, 2) + "\n");
  console.log(JSON.stringify({ output, ...summary }));
  if (changedSources.length || results.some(result => !result.exactStatusStdout)) process.exitCode = 1;
} finally { await rm(fixture, { recursive: true, force: true }); }
