import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, symlink, link, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const productMode = process.argv.includes("--product");
const output = resolve(process.argv[2]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const pins = {
  diff: ["/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff", "diff (GNU diffutils) 3.12", "f13ef516c397b0281818ffe8685aa763100b56a6549295c91849c6af937a83c9"],
  patch: ["/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch", "GNU patch 2.8", "c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00"],
  appleDiff: ["/usr/bin/diff", "Apple diff (based on FreeBSD diff)", "214a0d91e39424b15e1e3540edf6b33ee3dd2bbccb0c6dd3a9571dae754edede"],
  applePatch: ["/usr/bin/patch", "patch 2.0-12u11-Apple", "ca8aaa5fa4bd9dfaf4b3be251b18372f25f07483946e7d06b505e5a5fb0a6a84"],
};
const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" };
function native(executable, args, cwd, input = "") {
  assert(!args.includes("--atomic"));
  const result = spawnSync(executable, args, { cwd, input, encoding: "utf8", shell: false, timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, env: { ...environment, HOME: cwd, TMPDIR: cwd } });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { args, cwd, status: result.status, stdout: result.stdout, stderr: result.stderr, signal: result.signal };
}
async function identities() {
  const result = {};
  for (const [name, [path, version, sha256]] of Object.entries(pins)) {
    assert.equal(digest(await readFile(path)), sha256);
    const observed = native(path, ["--version"], process.cwd());
    assert.equal(observed.status, 0);
    assert.equal(observed.stdout.split("\n")[0], version);
    result[name] = { path, realpath: await realpath(path), sha256, ...observed };
  }
  return result;
}
const replacement = name => `--- ${name}\n+++ ${name}\n@@ -1 +1 @@\n-old\n+new\n`;
const first = "--- first\t2000-01-01 00:00:00 +0000\n+++ first\t2000-01-02 00:00:00 +0000\n@@ -1,1 +1,1 @@ agent replacement\n-keep\n+changed\n";
const backward = "@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+other\n";
const truncated = "@@ -1 +1,2 @@\n-old\n+new\n";
const cases = [
  { name: "quoted-path security: quoted ancestor symlink", kind: "quoted", input: replacement("first") + replacement('"alias/target"'), args: [], status: 0 },
  { name: "atomic extension malformed backward-second-hunk is not swallowed after a valid file section", kind: "backward", input: first + "--- target\n+++ target\n" + backward, args: [], status: 1 },
];
for (const format of ["normal", "context", "unified"]) for (const flag of ["-E", "--remove-empty-files"]) {
  const input = format === "normal" ? "1,2d0\n< alpha\n< beta\n" : format === "context"
    ? "*** old-label\n--- new-label\n***************\n*** 1,2 ****\n- alpha\n- beta\n--- 0 ----\n"
    : "--- old-label\n+++ new-label\n@@ -1,2 +0,0 @@\n-alpha\n-beta\n";
  cases.push({ name: `GNU default: ${format}/${flag}/apply`, kind: "empty", input, args: [flag, "/fixture/authorized/target"], status: 0 });
}
const control = { name: "true truncated syntax (separate control)", kind: "truncated", input: first + "--- target\n+++ target\n" + truncated, args: [], status: 2 };
async function setup(root, fixture) {
  const host = typeof root === "string";
  const directory = async path => host ? mkdir(join(root, path), { recursive: true }) : root.mkdir(path, { recursive: true });
  const write = async (path, text) => host ? writeFile(join(root, path), text) : root.writeFile(path, Buffer.from(text));
  const symbolic = async (target, path) => host ? symlink(target, join(root, path)) : root.symlink(target, path);
  await directory("/fixture/work");
  await directory("/outside");
  await write("/outside/sentinel", "outside sentinel\n\0\xff");
  if (host) await link(join(root, "outside/sentinel"), join(root, "outside/twin"));
  else await root.link("/outside/sentinel", "/outside/twin");
  await symbolic("sentinel", "/outside/alias");
  const files = fixture.kind === "quoted" ? { first: "old\n", target: "old\n", "dir/target": "old\n" }
    : fixture.kind === "empty" ? { "old-label": "old decoy\n", "new-label": "new decoy\n", sentinel: "do not touch\n" }
      : { first: "keep\n", target: "old\nmiddle\ntail\n" };
  for (const [path, text] of Object.entries(files)) {
    await directory(dirname(`/fixture/work/${path}`));
    await write(`/fixture/work/${path}`, text);
  }
  if (fixture.kind === "quoted") await symbolic("dir", "/fixture/work/alias");
  if (fixture.kind === "empty") {
    await directory("/fixture/authorized");
    await write("/fixture/authorized/target", "alpha\nbeta\n");
  }
}
async function namespace(root) {
  const result = {};
  const host = typeof root === "string";
  async function visit(path) {
    const stat = host ? await lstat(join(root, path)) : await root.lstat(path);
    const type = host ? stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "file" : stat.type;
    result[path] = { type, mode: stat.mode & 0o7777, nlink: stat.nlink, dev: stat.dev, ino: stat.ino };
    if (type === "file") result[path].hex = Buffer.from(host ? await readFile(join(root, path)) : await root.readFile(path)).toString("hex");
    if (type === "symlink") result[path].target = host ? await readlink(join(root, path)) : await root.readlink(path);
    if (type === "directory") {
      const names = host ? await readdir(join(root, path)) : (await root.readdir(path)).map(entry => entry.name);
      for (const name of names.sort()) await visit(`${path === "/" ? "" : path}/${name}`);
    }
  }
  await visit("/");
  for (const entry of Object.values(result)) assert(Number.isSafeInteger(entry.ino) && Number.isSafeInteger(entry.dev) && Number.isSafeInteger(entry.nlink));
  return result;
}
function verifyNamespace(before, after, fixture, atomic, host) {
  const expected = structuredClone(before);
  const modified = [];
  const text = (path, value) => { expected[path].hex = Buffer.from(value).toString("hex"); modified.push(path); };
  if (!atomic) {
    if (fixture.kind === "quoted") { text("/fixture/work/first", "new\n"); text("/fixture/work/target", "new\n"); }
    if (fixture.kind === "backward" || fixture.kind === "truncated") text("/fixture/work/first", "changed\n");
    if (fixture.kind === "backward") {
      text("/fixture/work/target", "new\nmiddle\ntail\n");
      const fixtureMode = host ? 0o644 : 0o666;
      assert.equal(before["/fixture/work/target"].mode, fixtureMode);
      expected["/fixture/work/target.orig"] = { type: "file", mode: fixtureMode, nlink: 1, hex: before["/fixture/work/target"].hex };
      expected["/fixture/work/target.rej"] = { type: "file", mode: fixtureMode, nlink: 1, hex: Buffer.from("--- target\n+++ target\n@@ -1 +1 @@\n-old\n+other\n").toString("hex") };
      modified.push("/fixture/work/target.orig", "/fixture/work/target.rej");
      if (host) expected["/fixture/work"].nlink += 2;
    }
    if (fixture.kind === "empty") {
      delete expected["/fixture/authorized/target"];
      delete expected["/fixture/authorized"];
      assert.equal(before["/fixture"].nlink, 4);
      expected["/fixture"].nlink = 3;
    }
  }
  assert.deepEqual(Object.keys(after).sort(), Object.keys(expected).sort(), "complete namespace, no path filtering");
  for (const [path, entry] of Object.entries(expected)) {
    if (modified.includes(path)) {
      const { ino, dev, ...actual } = after[path];
      const { ino: ignoredInode, dev: ignoredDevice, ...wanted } = entry;
      assert.deepEqual(actual, wanted, path);
    } else assert.deepEqual(after[path], entry, `unchanged identity/bytes/link count: ${path}`);
  }
  const relations = entries => Object.entries(entries).filter(([, entry]) => entry.type !== "directory").map(([path, entry]) => [path, Object.entries(entries).filter(([, other]) => entry.ino === other.ino && entry.dev === other.dev).map(([name]) => name).sort()]);
  for (const [path, peers] of relations(after)) assert.deepEqual(peers, path === "/outside/sentinel" || path === "/outside/twin" ? ["/outside/sentinel", "/outside/twin"] : [path]);
  return { modified, hardlinkRelations: relations(after), fullNamespaceVerified: true };
}
await mkdir(join(owned, ".work"), { recursive: true });
const root = await mkdtemp(join(owned, ".work/native-"));
const beforePins = await identities();
const observations = [];
const diffRegeneration = [];
for (const [name, oldText, newText] of [["first", "old\n", "new\n"], ['"alias/target"', "old\n", "new\n"]]) {
  await writeFile(join(root, "old"), oldText);
  await writeFile(join(root, "new"), newText);
  const result = native(pins.diff[0], ["-U0", "--label", name, "--label", name, "old", "new"], root);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, replacement(name));
  assert.equal(result.stderr, "");
  diffRegeneration.push(result);
}
for (const fixture of [...cases, control]) for (const dialect of ["gnu", "apple-control"]) {
  const caseRoot = await mkdtemp(join(root, "case-"));
  await setup(caseRoot, fixture);
  const before = await namespace(caseRoot);
  const args = fixture.args.map(value => value.startsWith("/fixture/") ? join(caseRoot, value) : value);
  const result = native(pins[dialect === "gnu" ? "patch" : "applePatch"][0], args, join(caseRoot, "fixture/work"), fixture.input);
  const after = await namespace(caseRoot);
  let proof;
  if (dialect === "gnu") {
    assert.equal(result.status, fixture.status, fixture.name);
    proof = verifyNamespace(before, after, fixture, false, true);
    if (fixture.kind === "quoted") assert.equal(result.stdout, "patching file first\npatching file target\n");
    if (fixture.kind === "empty") assert.equal(result.stdout, `patching file ${args.at(-1)}\n`);
    if (fixture.kind === "backward") assert.equal(result.stdout, "patching file first\npatching file target\nmisordered hunks! output would be garbled\nHunk #2 FAILED at 1.\n1 out of 2 hunks FAILED -- saving rejects to file target.rej\n");
    if (fixture.kind !== "truncated") assert.equal(result.stderr, "");
    else { assert.equal(result.stdout, "patching file first\npatching file target\n"); assert.match(result.stderr, /malformed patch at line 10/); }
  } else {
    for (const [path, entry] of Object.entries(before).filter(([path]) => path === "/outside" || path.startsWith("/outside/"))) assert.deepEqual(after[path], entry);
  }
  observations.push({ fixture, dialect, before, result, after, proof });
}
const product = [];
if (productMode) {
  const publicEntry = fileURLToPath(import.meta.resolve("virtual-bash"));
  assert.equal(publicEntry, join(process.cwd(), "dist/index.js"));
  const { MemoryFileSystem, Shell, diffPatchCommands } = await import("virtual-bash");
  for (const fixture of [...cases, control]) for (const atomic of fixture.kind === "backward" || fixture.kind === "truncated" ? [false, true] : [false]) {
    const fs = new MemoryFileSystem();
    await setup(fs, fixture);
    const before = await namespace(fs);
    const mutations = [];
    const observed = new Proxy(fs, { get(backing, key) {
      const value = Reflect.get(backing, key);
      if (typeof value !== "function") return value;
      return (...args) => {
        if (["writeFile", "appendFile", "rm", "rmdir", "rename", "mkdir", "link", "symlink", "copyFile"].includes(key)) mutations.push({ method: key, path: args[0], recursive: args[1]?.recursive ?? false });
        if (key === "rm") assert.notEqual(args[1]?.recursive, true);
        return Reflect.apply(value, backing, args);
      };
    } });
    const argv = ["patch", ...(atomic ? ["--atomic"] : []), ...fixture.args];
    const result = await new Shell({ fs: observed, cwd: "/fixture/work" }).use(diffPatchCommands()).exec(argv.map(value => `'${value.replaceAll("'", "'\\''")}'`).join(" "), { stdin: fixture.input });
    assert.equal(result.exitCode, fixture.status);
    const after = await namespace(fs);
    const proof = verifyNamespace(before, after, fixture, atomic, false);
    if (atomic) { assert.deepEqual(mutations, []); assert.equal(result.stdout, ""); assert.match(result.stderr, fixture.kind === "backward" ? /hunk 2 does not match target/ : /malformed|incomplete/); }
    if (fixture.kind === "empty") assert.deepEqual(mutations, [{ method: "rm", path: "/fixture/authorized/target", recursive: false }, { method: "rmdir", path: "/fixture/authorized", recursive: false }]);
    if (!atomic && fixture.kind !== "truncated") {
      const nativeResult = observations.find(item => item.dialect === "gnu" && item.fixture.name === fixture.name).result;
      const expectedStdout = fixture.kind === "empty" ? "patching file /fixture/authorized/target\n" : nativeResult.stdout;
      assert.equal(result.stdout, expectedStdout);
      assert.equal(result.stderr, nativeResult.stderr);
    }
    product.push({ fixture, atomicExtension: atomic, before, result, after, mutations, proof });
  }
}
assert.deepEqual(await identities(), beforePins);
await writeFile(output, `${JSON.stringify({ author: "independent reviewer; not expectation editor93986", capturedAt: new Date().toISOString(), pins: beforePins, root, exactConflicts: 8, separateMalformedControls: 1, diffRegeneration, observations, product, full3758Rerun: false, rootMapping: "Original virtual / maps to /fixture; sibling /outside has sentinel+hardlink+symlink. All entries and raw link counts retained. Native APFS directories count every child; Memory directories count child directories. No cross-platform inode identity equality is claimed." }, null, 2)}\n`);
await rm(root, { recursive: true });
console.log(JSON.stringify({ output, nativeGNUConflicts: 8, nativeGNUControls: 1, appleControls: 9, productChecks: product.length }));
