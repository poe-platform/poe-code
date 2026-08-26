import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDiffPatchCommands } from "../../../../src/commands/diff-patch/index.ts";
import { toByteSource } from "../../../../src/contracts/index.ts";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.ts";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const output = process.argv[2];
assert(output && isAbsolute(output), "Pass an absolute output JSON path; the checked-in capture is immutable");
const executables = {
  gnu: { diff: process.env.GNU_DIFF, patch: process.env.GNU_PATCH },
  bsd: { diff: "/usr/bin/diff", patch: "/usr/bin/patch" },
};
for (const path of Object.values(executables.gnu)) assert(path && isAbsolute(path), "GNU_DIFF and GNU_PATCH must be explicit absolute paths; no fallback");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = value => value === null ? null : { hex: Buffer.from(value).toString("hex"), utf8: Buffer.from(value).toString("utf8") };
const records = [];
const engines = ["gnu", "bsd", "product"];

async function sources() {
  const hashes = {};
  async function visit(directory) {
    for (const entry of (await readdir(join(repository, directory), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && path.endsWith(".ts")) hashes[path] = sha256(await readFile(join(repository, path)));
    }
  }
  await visit("src");
  return hashes;
}

async function native(engine, tool, args, files = {}, input = "") {
  const root = await mkdtemp(join(tmpdir(), "safe-bash-gnu-case-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      assert(/^[a-z]+$/u.test(name));
      await writeFile(join(root, name), content);
    }
    const env = { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root, XDG_CONFIG_HOME: root, LANG: "C", LC_ALL: "C", TZ: "UTC", PATCH_GET: "0" };
    const result = spawnSync(executables[engine][tool], args, { cwd: root, env, input: Buffer.from(input), shell: false, timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
    const target = await readFile(join(root, "target")).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    const artifacts = {};
    for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isFile() && !["old", "next", "target"].includes(entry.name)) artifacts[entry.name] = bytes(await readFile(join(root, entry.name)));
    return { argv: args, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: bytes(result.stdout ?? ""), stderr: bytes(result.stderr ?? ""), target: bytes(target), artifacts };
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function product(tool, args, files = {}, input = "") {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/work");
  for (const [name, content] of Object.entries(files)) await filesystem.writeFile(`/work/${name}`, Buffer.from(content));
  const stdout = [];
  const stderr = [];
  let byteCount = 0;
  const sink = chunks => ({ async write(chunk) { byteCount += chunk.length; assert(byteCount <= 1024 * 1024); chunks.push(chunk.slice()); } });
  const command = createDiffPatchCommands().find(candidate => candidate.name === tool);
  const result = await command.execute({ command: tool, args, fs: filesystem, cwd: "/work", env: { LANG: "C", LC_ALL: "C" }, signal: AbortSignal.timeout(3000), stdin: toByteSource(input), stdout: sink(stdout), stderr: sink(stderr) });
  const target = await filesystem.readFile("/work/target").catch(error => { if (error.code === "ENOENT") return null; throw error; });
  return { argv: args, exitCode: result.exitCode, signal: null, error: null, stdout: bytes(Buffer.concat(stdout)), stderr: bytes(Buffer.concat(stderr)), target: bytes(target), artifacts: null };
}

async function patchCase(id, input, before, after, args = [], status = 0, generator = "literal") {
  for (const engine of engines) {
    const argv = [...(engine === "product" ? [] : ["-f"]), "-p0", "-F0", ...args];
    const files = before === null ? {} : { target: before };
    const actual = engine === "product" ? await product("patch", argv, files, input) : await native(engine, "patch", argv, files, input);
    records.push({ id, generator, engine, tool: "patch", input: bytes(input), before: bytes(before), expected: { exitCode: status, target: bytes(after) }, actual,
      pass: actual.exitCode === status && actual.target?.hex === bytes(after)?.hex && actual.signal === null && actual.error === null });
  }
}

const startedAt = new Date().toISOString();
const sourceBefore = await sources();
const identities = {};
for (const engine of ["gnu", "bsd"]) {
  identities[engine] = {};
  for (const tool of ["diff", "patch"]) {
    const result = await native(engine, tool, ["--version"]);
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    identities[engine][tool] = { path: executables[engine][tool], sha256: sha256(await readFile(executables[engine][tool])), result };
  }
}
assert(identities.gnu.patch.result.stdout.utf8.startsWith("GNU patch 2.8\n"));
assert(identities.gnu.diff.result.stdout.utf8.startsWith("diff (GNU diffutils) 3.12\n"));

const workloads = [
  { id: "eof-context", before: "a\nz", after: "b\nz", args: ["-U1"] },
  { id: "zero-begin-delete", before: "a\nb\n", after: "b\n", args: ["-U0"] },
  { id: "zero-begin-insert", before: "b\n", after: "a\nb\n", args: ["-U0"] },
  { id: "zero-interior-delete", before: "a\nb\nc\n", after: "a\nc\n", args: ["-U0"] },
  { id: "normal-edits", before: "head\nold\ntail\nremove\n", after: "start\nhead\nnew\ntail\n", args: [] },
  { id: "context-edits", before: "head\nold\ntail\nremove\n", after: "start\nhead\nnew\ntail\n", args: ["-C1"] },
];
for (const workload of workloads) for (const generator of engines) {
  const argv = [...workload.args, "--label", "target", "--label", "target", "old", "next"];
  const files = { old: workload.before, next: workload.after };
  const actual = generator === "product" ? await product("diff", argv, files) : await native(generator, "diff", argv, files);
  records.push({ id: workload.id, engine: generator, tool: "diff", before: bytes(workload.before), after: bytes(workload.after), actual,
    pass: actual.exitCode === 1 && actual.signal === null && actual.error === null });
  const input = actual.stdout.utf8;
  const target = workload.id === "normal-edits" ? ["target"] : [];
  await patchCase(`${workload.id}-forward`, input, workload.before, workload.after, target, 0, generator);
  await patchCase(`${workload.id}-reverse`, input, workload.after, workload.before, ["-R", ...target], 0, generator);
}

const header = "--- target\n+++ target\n";
const asymmetric = `${header}@@ -1,2 +1,2 @@\n-old\n+new\n expected\n`;
await patchCase("asymmetric-F0-control", asymmetric, "old\nactual\n", "old\nactual\n", [], 1);
await patchCase("asymmetric-F1", asymmetric, "old\nactual\n", "new\nactual\n", ["-F1"]);
await patchCase("symmetric-F1-control", `${header}@@ -1,3 +1,3 @@\n upstream\n-old\n+new\n expected\n`, "local\nold\nactual\n", "local\nnew\nactual\n", ["-F1"]);
await patchCase("displaced-exact-F0", `${header}@@ -1,2 +1,2 @@\n head\n-old\n+new\n`, "prefix\nhead\nold\ntail\n", "prefix\nhead\nnew\ntail\n");
await patchCase("displaced-exact-F0-eof-control", `${header}@@ -1,2 +1,2 @@\n head\n-old\n+new\n`, "prefix\nhead\nold\n", "prefix\nhead\nnew\n");
await patchCase("displaced-exact-F0-symmetric-control", `${header}@@ -1,3 +1,3 @@\n head\n-old\n+new\n tail\n`, "prefix\nhead\nold\ntail\n", "prefix\nhead\nnew\ntail\n");
const removal = "--- target\n+++ /dev/null\n@@ -1 +0,0 @@\n-one\n";
const ordinary = `${header}@@ -1 +0,0 @@\n-one\n`;
for (const emptyFlag of [[], ["-E"]]) {
  const suffix = emptyFlag.length ? "-E" : "-default";
  await patchCase(`null-delete${suffix}`, removal, "one\n", null, emptyFlag);
  await patchCase(`null-reverse-absent${suffix}`, removal, null, "one\n", ["-R", ...emptyFlag]);
  await patchCase(`null-reverse-empty${suffix}`, removal, "", "one\n", ["-R", ...emptyFlag]);
  await patchCase(`ordinary-delete${suffix}`, ordinary, "one\n", emptyFlag.length ? null : "", emptyFlag);
  await patchCase(`ordinary-reverse-empty${suffix}`, ordinary, "", "one\n", ["-R", ...emptyFlag]);
}
const whitespace = `${header}@@ -1,3 +1,3 @@\n if (ready) {\n-  old value;\n+    new value;\n }\n`;
await patchCase("whitespace-loose", whitespace, "if\t(ready) {\n\told\tvalue;\n}\n", "if\t(ready) {\n    new value;\n}\n", ["-l"]);
await patchCase("whitespace-strict-control", whitespace, "if\t(ready) {\n\told\tvalue;\n}\n", "if\t(ready) {\n\told\tvalue;\n}\n", [], 1);
await patchCase("whitespace-exact-control", whitespace, "if (ready) {\n  old value;\n}\n", "if (ready) {\n    new value;\n}\n");
await patchCase("whitespace-missing-blank-control", `${header}@@ -1 +1 @@\n-old value\n+new value\n`, "oldvalue\n", "oldvalue\n", ["-l"], 1);
await patchCase("normal-literal", "0a1\n> start\n2c3\n< old\n---\n> new\n4d4\n< remove\n", "head\nold\ntail\nremove\n", "start\nhead\nnew\ntail\n", ["target"]);
await patchCase("context-literal", "*** target\n--- target\n***************\n*** 1,3 ****\n  head\n! old\n  tail\n--- 1,3 ----\n  head\n! new\n  tail\n", "head\nold\ntail\n", "head\nnew\ntail\n");
const sourceAfter = await sources();
const stableSources = JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter);
for (const record of records.filter(candidate => candidate.tool === "diff")) {
  const reference = records.find(candidate => candidate.tool === "diff" && candidate.id === record.id && candidate.engine === "gnu");
  record.matchesGnuBytes = record.actual.stdout.hex === reference.actual.stdout.hex;
  record.pass &&= record.matchesGnuBytes;
}
for (const record of records.filter(candidate => candidate.tool === "patch")) {
  const reference = records.find(candidate => candidate.tool === "patch" && candidate.id === record.id && candidate.generator === record.generator && candidate.engine === "gnu");
  record.matchesGnuStatusTarget = record.actual.exitCode === reference.actual.exitCode && record.actual.target?.hex === reference.actual.target?.hex
    && record.actual.signal === null && record.actual.error === null;
}
const summary = Object.fromEntries(engines.map(engine => {
  const selected = records.filter(record => record.engine === engine);
  return [engine, { total: selected.length, pass: selected.filter(record => record.pass).length, fail: selected.filter(record => !record.pass).length,
    gnuAgreement: selected.filter(record => record.tool === "diff" ? record.matchesGnuBytes && record.actual.exitCode === 1 : record.matchesGnuStatusTarget).length,
    failures: selected.filter(record => !record.pass).map(record => `${record.tool}:${record.id}:${record.generator ?? "self"}`) }];
}));
const git = spawnSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", timeout: 3000 });
const report = { schema: 1, startedAt, finishedAt: new Date().toISOString(), head: git.stdout.trim(), node: process.version, platform: process.platform, architecture: process.arch, stableSources,
  sourceTreeSha256Before: sha256(JSON.stringify(sourceBefore)), sourceTreeSha256After: sha256(JSON.stringify(sourceAfter)),
  sourceHashes: Object.fromEntries(Object.entries(sourceBefore).filter(([path]) => path.startsWith("src/commands/diff-patch/"))), identities, summary, records };
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output, stableSources, summary }, null, 2));
process.exitCode = !stableSources || records.some(record => !record.pass) ? 1 : 0;
