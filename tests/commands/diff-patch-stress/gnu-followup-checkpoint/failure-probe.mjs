import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const evidence = realpathSync(process.argv[2]);
const identity = JSON.parse(readFileSync(join(evidence, "identity.json"), "utf8"));
const snapshot = realpathSync(identity.snapshot);
assert.equal(realpathSync(process.cwd()), snapshot);
const productEntry = join(snapshot, "dist/index.js");
const { createDiffPatchCommands, MemoryFileSystem, toByteSource, isFsError } = await import(pathToFileURL(productEntry).href);
const oracle = JSON.parse(readFileSync(join(evidence, "oracle-before.stdout"), "utf8")).find(row => row.profile === "gnu" && row.tool === "patch");
assert.equal(createHash("sha256").update(readFileSync(oracle.path)).digest("hex"), oracle.sha256);
const replace = name => `--- ${name}\n+++ ${name}\n@@ -1 +1 @@\n-old\n+new\n`;
const backwards = "@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+other\n";
assert(readFileSync(join(snapshot, "tests/commands/diff-patch-stress/fuzz/edits.test.ts"), "utf8").includes(JSON.stringify(backwards)));
const first = "--- first\n+++ first\n@@ -1 +1 @@\n-keep\n+changed\n";
const cases = [
  { name: "quoted ancestor exact original default", files: { first: "old\n", target: "old\n", "dir/target": "old\n" }, links: { alias: "dir" }, args: [], input: replace("first") + replace('"alias/target"') },
  { name: "quoted ancestor retained-path safety control", files: { first: "old\n", target: "old\n", "dir/target": "old\n" }, links: { alias: "dir" }, args: ["-p0"], input: replace("first") + replace('"alias/target"') },
  { name: "backwards hunk exact original atomic", files: { first: "keep\n", target: "old\nmiddle\ntail\n" }, args: ["--atomic"], input: `${first}--- target\n+++ target\n${backwards}` },
  { name: "backwards hunk default GNU parity", files: { first: "keep\n", target: "old\nmiddle\ntail\n" }, args: [], input: `${first}--- target\n+++ target\n${backwards}` },
  { name: "truncated hunk malformed atomic control", files: { first: "keep\n", target: "old\nmiddle\ntail\n" }, args: ["--atomic"], input: `${first}--- target\n+++ target\n@@ -1 +1,2 @@\n-old\n+new\n` },
  { name: "author absolute dev-null reverse deletion", files: { target: "new\n" }, args: ["-R", "/work/target"], input: "--- /dev/null\n+++ /ignored/label\n@@ -0,0 +1 @@\n+new\n" },
];
const observations = [];
for (const fixture of cases) {
  const root = await mkdtemp(join(evidence, "failure-native-"));
  const nativeCwd = join(root, "work");
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await mkdir(nativeCwd);
  await fs.writeFile("/boundary", Buffer.from("outside sentinel\n"));
  await writeFile(join(root, "boundary"), "outside sentinel\n");
  try {
    for (const [path, text] of Object.entries(fixture.files)) {
      await fs.mkdir(dirname(`/work/${path}`), { recursive: true });
      await fs.writeFile(`/work/${path}`, Buffer.from(text));
      await mkdir(dirname(join(nativeCwd, path)), { recursive: true });
      await writeFile(join(nativeCwd, path), text);
    }
    for (const [path, target] of Object.entries(fixture.links ?? {})) { await fs.symlink(target, `/work/${path}`); await symlink(target, join(nativeCwd, path)); }
    async function namespace(native) {
      const entries = {};
      async function visit(path) {
        const stat = native ? await lstat(join(root, path)) : await fs.lstat(`/${path}`);
        const type = native ? stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file" : stat.type;
        const entry = { type, mode: stat.mode & 0o7777, ino: stat.ino, dev: stat.dev, nlink: stat.nlink };
        entries[path || "."] = entry;
        if (type === "file") entry.hex = Buffer.from(native ? await readFile(join(root, path)) : await fs.readFile(`/${path}`)).toString("hex");
        if (type === "symlink") entry.target = native ? await readlink(join(root, path)) : await fs.readlink(`/${path}`);
        if (type === "directory") for (const child of (native ? await readdir(join(root, path)) : (await fs.readdir(`/${path}`)).map(item => item.name)).sort()) await visit(path ? `${path}/${child}` : child);
      }
      await visit("");
      return entries;
    }
    const before = { product: await namespace(false), native: await namespace(true) };
    const mutations = [];
    const observed = new Proxy(fs, { get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      if (!["writeFile", "appendFile", "rm", "rename", "mkdir"].includes(key)) return value.bind(target);
      return async (...args) => {
        const call = { method: key, path: args[0], recursive: args[1]?.recursive };
        mutations.push(call);
        try { return await value.apply(target, args); }
        catch (error) { call.error = { typed: isFsError(error), code: error.code, message: error.message }; throw error; }
      };
    } });
    const stdout = [];
    const stderr = [];
    const product = await createDiffPatchCommands().find(command => command.name === "patch").execute({
      command: "patch", args: fixture.args, fs: observed, cwd: "/work", env: {}, signal: AbortSignal.timeout(5000), stdin: toByteSource(fixture.input),
      stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } }, stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
    });
    const nativeArgs = ["--batch", ...fixture.args.filter(arg => arg !== "--atomic").map(arg => arg === "/work/target" ? `${nativeCwd}/target` : arg)];
    const native = spawnSync(oracle.path, nativeArgs, { cwd: nativeCwd, input: fixture.input, encoding: "utf8", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" }, timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1048576 });
    assert.ifError(native.error);
    assert.equal(native.signal, null);
    observations.push({ ...fixture, before, product: { ...product, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), mutations, after: await namespace(false) },
      native: { args: nativeArgs, cwd: nativeCwd, exitCode: native.status, stdout: native.stdout, stderr: native.stderr, after: await namespace(true) } });
  } finally { await rm(root, { recursive: true, force: true }); }
}
function semantics(entries) { return Object.fromEntries(Object.entries(entries).map(([path, { type, hex, target }]) => [path, { type, ...(hex === undefined ? {} : { hex }), ...(target === undefined ? {} : { target }) }])); }
const [quoted, retained, atomic, ordinary, malformed, absolute] = observations;
assert.equal(quoted.product.exitCode, 0);
assert.equal(quoted.native.exitCode, 0);
assert.deepEqual(semantics(quoted.product.after), semantics(quoted.native.after));
assert.deepEqual(quoted.product.after["work/alias"], quoted.before.product["work/alias"]);
assert.deepEqual(quoted.product.after["work/dir/target"], quoted.before.product["work/dir/target"]);
assert.equal(retained.product.exitCode, 2);
assert.deepEqual(retained.product.mutations, []);
assert.deepEqual(retained.product.after, retained.before.product);
assert.equal(atomic.native.exitCode, 1);
assert.equal(atomic.product.exitCode, 1);
assert.deepEqual(atomic.product.mutations, []);
assert.deepEqual(atomic.product.after, atomic.before.product);
assert.equal(ordinary.native.exitCode, 1);
assert.equal(ordinary.product.exitCode, 1);
assert.deepEqual(semantics(ordinary.product.after), semantics(ordinary.native.after));
assert.equal(malformed.native.exitCode, 2);
assert.equal(malformed.product.exitCode, 2);
assert.deepEqual(malformed.product.mutations, []);
assert.deepEqual(malformed.product.after, malformed.before.product);
assert.equal(absolute.native.exitCode, 0);
assert.equal(absolute.product.exitCode, 2);
assert(absolute.product.mutations.some(call => call.path === "/work" && call.recursive === false && call.error?.typed && call.error.code === "EISDIR"));
console.log(JSON.stringify({ classificationOnly: true, productEntry, oracle, observations }, null, 2));
