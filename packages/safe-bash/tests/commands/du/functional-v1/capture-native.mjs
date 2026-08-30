import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeCases } from "./native-cases.ts";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.ts";
import { createRealFileSystem } from "../../../../src/fs/real/index.ts";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../../..");
const oracle = join(root, "tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du");
const expected = "f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b";
const hash = async path => createHash("sha256").update(await readFile(path)).digest("hex");
assert.equal(await hash(oracle), expected);
await mkdir(join(directory, "evidence"), { recursive: true });
const output = await mkdtemp(join(directory, "evidence/native-v1-"));
const fixture = await mkdtemp(join(directory, ".native-v1-"));
try {
  await writeFile(join(fixture, "file"), new Uint8Array(1025));
  const results = nativeCases.map(item => {
    const result = spawnSync(oracle, item.args, { cwd: fixture, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", ...item.env }, encoding: "utf8", timeout: 10000, maxBuffer: 65536 });
    if (result.error || result.status === null) throw result.error ?? new Error("native child did not exit");
    return { ...item, status: result.status, stdout: result.stdout, stderr: result.stderr };
  });
  const emptyFsObservations = [];
  for (const [provider, fs] of [["memory", createMemoryFileSystem()], ["rooted-real", await createRealFileSystem({ root: fixture })]]) {
    try { const stat = await fs.lstat(""); emptyFsObservations.push({ provider, input: "", outcome: "returned stat", type: stat.type }); }
    catch (error) { emptyFsObservations.push({ provider, input: "", outcome: "rejected", code: error.code, message: error.message }); }
  }
  assert.equal(await hash(oracle), expected);
  const sourceFiles = ["src/commands/du/arguments.ts", "src/commands/du/du.ts", "tests/commands/du/functional-v1/native-cases.ts", "tests/commands/du/functional-v1/capture-native.mjs"];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, await hash(join(root, path))])));
  await writeFile(join(output, "native.json"), JSON.stringify({ profile: "GNU coreutils 9.7 on Darwin; controlled environment; no inherited credentials", created: new Date().toISOString(), platform: process.platform, node: process.version, oracle, binarySha256: expected, binaryAfterSha256: await hash(oracle), sourceHead: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), sourceHashes, fixtureRoot: fixture, fixture: { fileBytes: 1025, content: "all zero bytes" }, emptyFsObservations, results }, null, 2) + "\n");
  console.log(JSON.stringify({ output, cases: results.length, emptyFsObservations }));
} finally { await rm(fixture, { recursive: true, force: true }); }
