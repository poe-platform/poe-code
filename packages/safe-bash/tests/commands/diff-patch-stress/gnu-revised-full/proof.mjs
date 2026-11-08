import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { replacement } from "../editflows/fixtures.ts";
import { memory } from "../editflows/helpers.ts";
import { golden, run } from "../fuzz/helpers.ts";
import { execute, observe, setup, target } from "../emptyfile-delta/helpers.ts";
import { vectors } from "../emptyfile-delta/vectors.ts";
import { oracleIdentity } from "../gnu-target/oracle.ts";

const output = process.argv[2];
assert(output);
const pins = ["gnu", "apple-calibration"].flatMap(profile => ["diff", "patch"].map(tool => ({ profile, tool, ...oracleIdentity(tool, profile) })));
const patch = pins.find(pin => pin.profile === "gnu" && pin.tool === "patch");
const diff = pins.find(pin => pin.profile === "gnu" && pin.tool === "diff");
const records = { role: "expectation editor/author, not independent reviewer", pins, directoryLinkCounts: { virtual: "2 + immediate child directories", nativeHost: "2 + all immediate entries, asserted explicitly; not GNU utility dialect behavior", removedAuthorizedParent: "root 4 -> 3 in both" }, exact: [], controls: [], generation: [] };
const persist = () => writeFile(output, JSON.stringify(records, null, 2) + "\n");
await persist();

async function namespace(filesystem) {
  const entries = {};
  const identities = new Map();
  async function visit(path) {
    const stat = await filesystem.lstat(path);
    const key = `${stat.dev}:${stat.ino}`;
    if (stat.type === "file" && !identities.has(key)) identities.set(key, path);
    entries[path] = { type: stat.type, mode: stat.mode, nlink: stat.nlink,
      ...(stat.type === "file" ? { bytes: Buffer.from(await filesystem.readFile(path)).toString("base64"), alias: identities.get(key) }
        : stat.type === "symlink" ? { link: await filesystem.readlink(path) } : {}) };
    if (stat.type === "directory") for (const entry of (await filesystem.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) await visit(`${path === "/" ? "" : path}/${entry.name}`);
  }
  await visit("/");
  return entries;
}

async function hostNamespace(root) {
  const filesystem = {
    async lstat(path) {
      const stat = await lstat(join(root, path));
      return { ...stat, type: stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "file" };
    },
    readFile: path => readFile(join(root, path)),
    readlink: path => readlink(join(root, path)),
    readdir: path => readdir(join(root, path), { withFileTypes: true }),
  };
  return namespace(filesystem);
}

const semantics = entries => Object.fromEntries(Object.entries(entries).map(([path, { mode, ...entry }]) => [path, entry]));
function hostExpected(entries) {
  const result = structuredClone(entries);
  for (const [path, entry] of Object.entries(result)) {
    if (entry.type !== "directory") continue;
    const prefix = path === "/" ? "/" : `${path}/`;
    entry.nlink = 2 + Object.keys(result).filter(candidate => candidate !== path && candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/")).length;
  }
  return result;
}
function expectedWrites(before, writes) {
  const result = structuredClone(before);
  for (const [path, bytes] of Object.entries(writes)) {
    result[path] = { ...(result[path] ?? { type: "file", nlink: 1, alias: path }), bytes: Buffer.from(bytes).toString("base64") };
  }
  return result;
}

async function native(before, args, input) {
  assert(!args.includes("--atomic"));
  const envelope = await mkdtemp(join(process.env.TMPDIR, "exact-eight-native-"));
  const root = join(envelope, "namespace");
  await mkdir(root);
  await writeFile(join(envelope, "sentinel"), "outside namespace sentinel\n");
  for (const [path, entry] of Object.entries(before)) {
    const destination = join(root, path);
    assert(!relative(root, destination).startsWith(".."));
    if (path === "/") continue;
    if (entry.type === "directory") await mkdir(destination);
    else if (entry.type === "symlink") {
      assert(!entry.link.startsWith("/") && !entry.link.split("/").includes(".."));
      await symlink(entry.link, destination);
    } else if (entry.alias !== path) await link(join(root, entry.alias), destination);
    else await writeFile(destination, Buffer.from(entry.bytes, "base64"));
    if (entry.type !== "symlink") await chmod(destination, entry.mode & 0o777);
  }
  const initial = await hostNamespace(root);
  assert.deepEqual(semantics(initial), hostExpected(semantics(before)));
  const mappedArgs = args.map(value => value === "/authorized/target" ? join(root, value) : value);
  const result = spawnSync(patch.path, mappedArgs, { cwd: join(root, "work"), input, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 65536, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" } });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(await readFile(join(envelope, "sentinel"), "utf8"), "outside namespace sentinel\n");
  assert.deepEqual((await readdir(envelope)).sort(), ["namespace", "sentinel"]);
  const after = await hostNamespace(root);
  for (const [path, entry] of Object.entries(initial)) if (after[path]) assert.equal(after[path].mode, entry.mode, `native retained-entry mode: ${path}`);
  return { envelope, root, args: mappedArgs, originalArgs: args, input, exitCode: result.status, stdout: result.stdout, stderr: result.stderr, normalizedStdout: result.stdout.replaceAll(root, ""), normalizedStderr: result.stderr.replaceAll(root, ""), before: initial, after, sentinel: "unchanged", retained: true };
}

function traced(filesystem) {
  const calls = [];
  return { calls, fs: new Proxy(filesystem, { get(backing, property) {
    const value = Reflect.get(backing, property, backing);
    if (typeof value !== "function") return value;
    if (!["writeFile", "rm", "rmdir", "rename", "link", "symlink", "mkdir"].includes(property)) return value.bind(backing);
    return (...args) => {
      const options = args[property === "writeFile" ? 2 : 1];
      calls.push({ method: property, path: args[0], recursive: options?.recursive === true, signalPresent: options?.signal instanceof AbortSignal });
      return Reflect.apply(value, backing, args);
    };
  } }) };
}

async function decorate(filesystem) {
  await filesystem.writeFile("/work/proof-sentinel", Buffer.from("protected\n"));
  await filesystem.link("/work/proof-sentinel", "/work/proof-hard-alias");
  await filesystem.symlink("proof-sentinel", "/work/proof-link");
}

for (const [label, before, after] of [["first", "keep", "changed"], ["first", "old", "new"], ['"alias/target"', "old", "new"]]) {
  const root = await mkdtemp(join(process.env.TMPDIR, "exact-eight-diff-"));
  await writeFile(join(root, "old"), `${before}\n`);
  await writeFile(join(root, "new"), `${after}\n`);
  const result = spawnSync(diff.path, ["-u", "--label", label, "--label", label, "old", "new"], { cwd: root, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 65536, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" } });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, replacement(label, label, before, after));
  records.generation.push({ root, label, stdout: result.stdout, exitCode: result.status });
}

for (const protectedAliases of [false, true]) {
  const filesystem = await memory({ first: "old\n", target: "old\n", "dir/target": "old\n" });
  await filesystem.symlink("dir", "/work/alias");
  if (protectedAliases) await decorate(filesystem);
  const before = await namespace(filesystem);
  const input = replacement("first") + replacement('"alias/target"');
  const trace = traced(filesystem);
  const product = await run("patch", [], trace.fs, input);
  const after = await namespace(filesystem);
  const reference = await native(before, [], input);
  const record = { name: "quoted-path security: quoted ancestor symlink", protectedAliases, input, args: [], product: { ...product, before, after, trace: trace.calls }, native: reference };
  (protectedAliases ? records.controls : records.exact).push(record);
  await persist();
  assert.equal(product.exitCode, 0);
  assert.equal(reference.exitCode, 0);
  assert.equal(product.stdout, "patching file first\npatching file target\n");
  assert.equal(reference.stdout, product.stdout);
  assert.equal(product.stderr, "");
  assert.equal(reference.stderr, "");
  const expected = expectedWrites(semantics(before), { "/work/first": "new\n", "/work/target": "new\n" });
  assert.deepEqual(semantics(after), expected);
  assert.deepEqual(semantics(reference.after), hostExpected(expected));
  assert.deepEqual(trace.calls.map(({ method, path }) => ({ method, path })), ["first", "target"].map(name => ({ method: "writeFile", path: `/work/${name}` })));
}

const malformedSource = await readFile(new URL("../fuzz/edits.test.ts", import.meta.url), "utf8");
const extract = name => JSON.parse(malformedSource.match(new RegExp(`"${name}": ("(?:[^"\\\\]|\\\\.)*"),`))[1]);
for (const suffix of ["backward-second-hunk", "missing-new-body"]) {
  for (const protectedAliases of [false, true]) {
    const filesystem = await memory({ first: "keep\n", target: "old\nmiddle\ntail\n" });
    if (protectedAliases) await decorate(filesystem);
    const before = await namespace(filesystem);
    const input = `${golden("keep\n", "changed\n", "first")}--- target\n+++ target\n${extract(suffix)}`;
    const trace = traced(filesystem);
    const product = await run("patch", ["--atomic"], trace.fs, input);
    const after = await namespace(filesystem);
    const reference = await native(before, [], input);
    const record = { name: `atomic extension malformed ${suffix} is not swallowed after a valid file section`, protectedAliases, input, args: ["--atomic"], product: { ...product, before, after, trace: trace.calls }, native: reference };
    (suffix === "backward-second-hunk" && !protectedAliases ? records.exact : records.controls).push(record);
    await persist();
    assert.equal(product.exitCode, suffix === "backward-second-hunk" ? 1 : 2);
    assert.equal(reference.exitCode, product.exitCode);
    assert.equal(product.stdout, "");
    assert.deepEqual(after, before);
    assert.deepEqual(trace.calls, []);
    assert.equal(product.stderr, suffix === "backward-second-hunk" ? "patch: hunk 2 does not match target\n" : "patch: truncated or malformed hunk body\n");
    if (suffix === "backward-second-hunk") {
      assert.equal(reference.stdout, "patching file first\npatching file target\nmisordered hunks! output would be garbled\nHunk #2 FAILED at 1.\n1 out of 2 hunks FAILED -- saving rejects to file target.rej\n");
      assert.equal(reference.stderr, "");
      const expected = expectedWrites(semantics(before), { "/work/first": "changed\n", "/work/target": "new\nmiddle\ntail\n", "/work/target.orig": "old\nmiddle\ntail\n", "/work/target.rej": "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+other\n" });
      assert.deepEqual(semantics(reference.after), hostExpected(expected));
    } else {
      assert.equal(reference.stdout, "patching file first\npatching file target\n");
      assert.equal(reference.stderr, `${patch.path}: **** malformed patch at line 10:  \n\n`);
      assert.deepEqual(semantics(reference.after), hostExpected(expectedWrites(semantics(before), { "/work/first": "changed\n" })));
    }
  }
}

const selected = vectors.filter(vector => vector.status === 0 && vector.expected === null && !vector.args.includes("--dry-run") && target(vector) === "/authorized/target");
assert.equal(selected.length, 6);
for (const vector of selected) for (const protectedAliases of [false, true]) {
  const filesystem = await setup(vector);
  if (protectedAliases) await decorate(filesystem);
  const before = await namespace(filesystem);
  const observer = observe(filesystem);
  const trace = traced(observer.fs);
  const product = await execute(trace.fs, vector.args, vector.input);
  const after = await namespace(filesystem);
  const reference = await native(before, vector.args, vector.input);
  const record = { name: `GNU default: ${vector.name}`, protectedAliases, vector, product: { ...product, before, after, trace: trace.calls, originalObserver: observer.mutations.map(({ method, path }) => ({ method, path })) }, native: reference };
  (protectedAliases ? records.controls : records.exact).push(record);
  await persist();
  assert.equal(product.exitCode, 0);
  assert.equal(reference.exitCode, 0);
  assert.equal(product.stdout, "patching file /authorized/target\n");
  assert.equal(reference.normalizedStdout, product.stdout);
  assert.equal(product.stderr, "");
  assert.equal(reference.stderr, "");
  const expected = structuredClone(semantics(before));
  delete expected["/authorized/target"];
  delete expected["/authorized"];
  assert.equal(expected["/"].nlink, 4);
  expected["/"].nlink = 3;
  assert.deepEqual(semantics(after), expected);
  assert.deepEqual(semantics(reference.after), hostExpected(expected));
  assert.deepEqual(trace.calls.map(({ method, path }) => ({ method, path })), [{ method: "rm", path: "/authorized/target" }, { method: "rmdir", path: "/authorized" }]);
  assert(trace.calls.every(call => !call.recursive && call.signalPresent));
  assert.deepEqual(record.product.originalObserver, [{ method: "rm", path: "/authorized/target" }]);
}

for (const atomic of [false, true]) {
  const filesystem = await memory({ first: "old\n", target: "old\n", "dir/target": "old\n" });
  await filesystem.symlink("dir", "/work/alias");
  await decorate(filesystem);
  const before = await namespace(filesystem);
  const input = replacement("first") + replacement('"alias/target"');
  const trace = traced(filesystem);
  const args = [...(atomic ? ["--atomic"] : []), "-p0"];
  const product = await run("patch", args, trace.fs, input);
  const after = await namespace(filesystem);
  const reference = atomic ? null : await native(before, ["-p0"], input);
  records.controls.push({ name: `selected quoted ancestor -p0 ${atomic ? "atomic" : "ordinary"}`, args, input, product: { ...product, before, after, trace: trace.calls }, native: reference });
  await persist();
  assert.equal(product.exitCode, 2);
  assert.match(product.stderr, /symlink/iu);
  assert.equal(product.stdout, "");
  assert.deepEqual(after, before);
  assert.deepEqual(trace.calls, []);
  if (reference) {
    assert.equal(reference.exitCode, 0);
    assert.deepEqual(semantics(reference.after), hostExpected(expectedWrites(semantics(before), { "/work/first": "new\n", "/work/dir/target": "new\n" })));
    assert.equal(reference.stdout, "patching file first\npatching file alias/target\n");
    assert.equal(reference.stderr, "");
  }
}
assert.equal(records.exact.length, 8);
assert.equal(records.controls.length, 12);
for (const record of [...records.exact, ...records.controls]) {
  for (const [path, entry] of Object.entries(record.product.before)) if (record.product.after[path]) assert.equal(record.product.after[path].mode, entry.mode, `product retained-entry mode: ${path}`);
}
records.accepted = true;
await persist();
console.log(JSON.stringify({ exact: records.exact.length, controls: records.controls.length, diffRegenerations: records.generation.length, accepted: true }));
