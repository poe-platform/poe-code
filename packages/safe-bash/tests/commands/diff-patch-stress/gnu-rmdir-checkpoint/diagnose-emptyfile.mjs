import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const moduleAt = path => import(pathToFileURL(join(root, path)).href);
const helpers = await moduleAt("tests/commands/diff-patch-stress/emptyfile-delta/helpers.ts");
const { vectors, decoys } = await moduleAt("tests/commands/diff-patch-stress/emptyfile-delta/vectors.ts");
const { oracleIdentity } = await moduleAt("tests/commands/diff-patch-stress/gnu-target/oracle.ts");
const oracle = oracleIdentity("patch");
const selected = vectors.filter(vector => vector.status === 0 && vector.expected === null && !vector.args.includes("--dry-run") && helpers.target(vector) === "/authorized/target");
assert.equal(selected.length, 6);
async function hostNamespace(root) {
  const result = {};
  async function visit(path) {
    const stat = await lstat(path);
    const name = path === root ? "/" : `/${relative(root, path)}`;
    result[name] = { type: stat.isDirectory() ? "directory" : "file", nlink: stat.nlink, mode: stat.mode, ...(stat.isFile() ? { bytes: (await readFile(path)).toString("base64") } : {}) };
    if (stat.isDirectory()) for (const name of await readdir(path)) await visit(join(path, name));
  }
  await visit(root);
  return result;
}
const semantics = entries => Object.fromEntries(Object.entries(entries).map(([path, entry]) => [path, { type: entry.type, ...(entry.bytes === undefined ? {} : { bytes: entry.bytes }) }]));
const observations = [];
for (const vector of selected) {
  const fs = await helpers.setup(vector);
  const before = await helpers.snapshot(fs);
  const observed = helpers.observe(fs);
  const actualRemovalCalls = [];
  const proxy = new Proxy(observed.fs, { get(backing, key) {
    const value = Reflect.get(backing, key);
    if (key !== "rm" && key !== "rmdir") return value;
    return async (...args) => {
      actualRemovalCalls.push({ method: key, path: args[0], recursive: args[1]?.recursive, options: Object.keys(args[1] ?? {}) });
      return value(...args);
    };
  } });
  const result = await helpers.execute(proxy, vector.args, vector.input);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  const after = await helpers.snapshot(fs);
  const originalExpected = structuredClone(before);
  delete originalExpected["/authorized/target"];
  delete originalExpected["/authorized"];
  assert.notDeepEqual(after, originalExpected, "the frozen metadata expectation must remain failing");
  const diagnosedExpected = structuredClone(originalExpected);
  diagnosedExpected["/"].nlink--;
  assert.deepEqual(after, diagnosedExpected, "the only complete-namespace difference is root directory nlink");
  assert.deepEqual(actualRemovalCalls.map(({ method, path }) => ({ method, path })), [{ method: "rm", path: "/authorized/target" }, { method: "rmdir", path: "/authorized" }]);
  assert(actualRemovalCalls.every(call => call.recursive !== true));
  const originalObservedMutations = observed.mutations.map(({ method, path }) => ({ method, path }));
  const originalExpectedMutations = [{ method: "rm", path: "/authorized/target" }, { method: "rm", path: "/authorized" }];
  assert.deepEqual(originalObservedMutations, [{ method: "rm", path: "/authorized/target" }]);
  assert.notDeepEqual(originalObservedMutations, originalExpectedMutations, "unchanged later assertion expects forbidden directory rm");
  const nativeRoot = await mkdtemp(join(tmpdir(), "native-emptyfile-diagnosis-"));
  await mkdir(join(nativeRoot, "work"));
  await mkdir(join(nativeRoot, "authorized"));
  for (const [path, value] of Object.entries(decoys)) await writeFile(join(nativeRoot, "work", path), value);
  await writeFile(join(nativeRoot, "authorized/target"), vector.initial);
  const nativeBefore = await hostNamespace(nativeRoot);
  const nativeArgs = vector.args.map(value => value === "/authorized/target" ? join(nativeRoot, "authorized/target") : value);
  const native = spawnSync(oracle.path, nativeArgs, { cwd: join(nativeRoot, "work"), input: vector.input, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" } });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  assert.equal(native.status, 0, native.stderr);
  assert.equal(native.stderr, "");
  const nativeAfter = await hostNamespace(nativeRoot);
  assert.deepEqual(semantics(after), semantics(nativeAfter), "GNU complete byte/namespace effects agree independently");
  assert.equal(nativeAfter["/"].nlink, nativeBefore["/"].nlink - 1, "native directory removal also decrements parent nlink");
  observations.push({ name: `GNU default: ${vector.name}`, vector, product: { result, before, after, actualRemovalCalls, originalObservedMutations, originalExpectedMutations, originalMetadataExpected: originalExpected }, native: { root: nativeRoot, args: nativeArgs, exitCode: native.status, stdout: native.stdout, stderr: native.stderr, before: nativeBefore, after: nativeAfter }, diagnosis: "successful pruning exposes stale parent-nlink and directory-rm instrumentation expectations; NOT waived, original test remains failing" });
}
console.log(JSON.stringify({ oracle, cases: observations.length, observations, original3758ReclassifiedAsPass: false, originalTestsEdited: false, original3758Rerun: false, ownerRouting: "ROOT and diff-patch test owner review frozen expectation contradictions; Poincare owns filesystem source. No source fix requested or made by verifier." }, null, 2));
