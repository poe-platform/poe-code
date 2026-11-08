import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join, posix } from "node:path";
import { FsError, MemoryFileSystem, createDiffPatchCommands, isFsError, toByteSource } from "virtual-bash";

const entry = fileURLToPath(import.meta.resolve("virtual-bash"));
assert.equal(entry, join(process.cwd(), "dist/index.js"));
const observations = [];
const target = "/work/tree/leaf/target";
const leaf = "/work/tree/leaf";
const remove = name => `--- ${name}\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n`;
const replace = name => `--- ${name}\n+++ ${name}\n@@ -1 +1 @@\n-old\n+new\n`;
const file = text => ({ type: "file", hex: Buffer.from(text).toString("hex") });
async function namespace(fs) {
  const result = {};
  async function visit(path) {
    const stat = await fs.lstat(path);
    result[path] = stat.type === "file" ? file(Buffer.from(await fs.readFile(path))) : stat.type === "symlink" ? { type: stat.type, target: await fs.readlink(path) } : { type: stat.type };
    if (stat.type === "directory") for (const entry of await fs.readdir(path)) await visit(posix.join(path, entry.name));
  }
  await visit("/");
  return result;
}
async function fixture(kind) {
  const fs = new MemoryFileSystem();
  await fs.mkdir(leaf, { recursive: true });
  await fs.mkdir("/outside");
  await fs.writeFile(target, Buffer.from("old\n"));
  await fs.writeFile("/outside/sentinel", Buffer.from("untouched\n"));
  await fs.writeFile("/work/sentinel", Buffer.from("keep cwd\n"));
  if (kind === "selected-final-symlink") {
    await fs.rm(target);
    await fs.symlink("/outside/sentinel", target);
  }
  if (kind === "selected-ancestor-symlink") await fs.symlink("/outside", "/work/alias");
  if (kind === "selected-output-symlink") await fs.symlink("/outside/sentinel", `${target}.rej`);
  return fs;
}
for (const atomic of [false, true]) {
  for (const kind of ["empty-chain", "concurrent-child", "absent-rmdir", "EACCES", "EIO", "transport", "selected-final-symlink", "selected-ancestor-symlink", "selected-output-symlink", "rmdir-parent-replaced-by-symlink", "cancel-ENOENT"]) {
    const fs = await fixture(kind);
    const before = await namespace(fs);
    const expected = structuredClone(before);
    const controller = new AbortController();
    const calls = [];
    const mutations = [];
    let listedEmpty = false;
    let typedError;
    const reason = new FsError("ENOENT", { syscall: "cancel", path: leaf });
    const observed = new Proxy(fs, {
      get(backing, key) {
        if (kind === "absent-rmdir" && key === "rmdir") return undefined;
        const value = Reflect.get(backing, key);
        if (typeof value !== "function") return value;
        if (key === "readStream") return value.bind(backing);
        return async (...args) => {
          const path = args[0];
          if (["rm", "rmdir", "readdir"].includes(key)) calls.push({ method: key, path, recursive: args[1]?.recursive, suppliedSignal: args[1]?.signal === controller.signal });
          if (["writeFile", "appendFile", "rm", "rmdir", "rename", "mkdir", "copyFile"].includes(key)) mutations.push({ method: key, path });
          if (key === "rm") {
            assert.notEqual(args[1]?.recursive, true, "consumer must never use recursive rm");
            assert.notEqual((await backing.lstat(path)).type, "directory", "consumer must never use rm for a directory");
          }
          if (key === "readdir") {
            const entries = await value.apply(backing, args);
            if (path === leaf && entries.length === 0) listedEmpty = true;
            return entries;
          }
          if (key === "rmdir") {
            assert.equal(args[1]?.signal, controller.signal);
            assert.deepEqual(Object.keys(args[1]), ["signal"]);
            if (kind === "concurrent-child") {
              assert.equal(path, leaf);
              assert(listedEmpty, "race must occur after empty observation");
              await backing.mkdir(`${leaf}/child`);
              await backing.writeFile(`${leaf}/child/data`, Buffer.from("concurrent survives\n"));
            }
            if (kind === "rmdir-parent-replaced-by-symlink") {
              assert.equal(path, leaf);
              assert(listedEmpty);
              await backing.rmdir(leaf);
              await backing.symlink("/outside", leaf);
            }
            if (kind === "EACCES" || kind === "EIO") throw new FsError(kind, { syscall: "rmdir", path });
            if (kind === "transport") throw new Error("independent transport disconnect");
            if (kind === "cancel-ENOENT") { controller.abort(reason); throw reason; }
            try { return await value.apply(backing, args); }
            catch (error) {
              typedError = { typed: isFsError(error), code: error.code, path: error.path };
              throw error;
            }
          }
          return value.apply(backing, args);
        };
      },
    });
    const args = ["--batch", "-p0", ...(atomic ? ["--atomic"] : [])];
    let input = remove("tree/leaf/target");
    if (kind === "selected-ancestor-symlink") input = remove("alias/sentinel").replace("-old", "-untouched");
    if (kind === "selected-output-symlink") input = replace("tree/leaf/target").replace("-old", "-wrong");
    const stdout = [];
    const stderr = [];
    let result;
    let rejected;
    try {
      result = await createDiffPatchCommands().find(command => command.name === "patch").execute({
        command: "patch", args, fs: observed, cwd: "/work", env: {}, signal: controller.signal, stdin: toByteSource(input),
        stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } }, stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
      });
    } catch (error) { rejected = error; }
    const output = { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
    if (kind.startsWith("selected-")) {
      assert.equal(rejected, undefined);
      assert.equal(result.exitCode, kind === "selected-output-symlink" && atomic ? 1 : 2, output.stderr);
      assert.match(output.stderr, kind === "selected-output-symlink" && atomic ? /hunk.*does not match/iu : /symlink|symbolic|not a regular file/iu);
      assert.deepEqual(mutations, [], "selected symlink rejected before any mutation");
    } else {
      delete expected[target];
      if (kind === "empty-chain") {
        assert.equal(rejected, undefined);
        assert.equal(result.exitCode, 0, output.stderr);
        assert.equal(output.stderr, "");
        delete expected[leaf];
        delete expected["/work/tree"];
        assert.deepEqual(calls.filter(call => call.method === "rmdir").map(call => call.path), [leaf, "/work/tree"]);
      } else if (kind === "concurrent-child") {
        assert.equal(rejected, undefined);
        assert.equal(result.exitCode, 0, output.stderr);
        assert.equal(output.stderr, "");
        assert.equal(typedError?.typed, true);
        assert.equal(typedError?.code, "ENOTEMPTY");
        expected[`${leaf}/child`] = { type: "directory" };
        expected[`${leaf}/child/data`] = file("concurrent survives\n");
      } else if (kind === "cancel-ENOENT") {
        assert.equal(rejected, reason, "caller abort with ENOENT must not be swallowed");
      } else {
        assert.equal(rejected, undefined);
        assert.equal(result.exitCode, 2, output.stderr);
        assert(output.stderr.includes(leaf), "failure must preserve pruning path");
        if (kind === "absent-rmdir") assert.match(output.stderr, /ENOTSUP/u);
        if (kind === "EACCES" || kind === "EIO") assert(output.stderr.includes(kind));
        if (kind === "transport") assert.match(output.stderr, /independent transport disconnect/u);
        if (kind === "rmdir-parent-replaced-by-symlink") {
          assert.equal(typedError?.typed, true);
          assert.equal(typedError?.code, "ENOTDIR");
          expected[leaf] = { type: "symlink", target: "/outside" };
        }
      }
    }
    const after = await namespace(fs);
    assert.deepEqual(after, expected, `complete namespace: ${kind}, atomic=${atomic}`);
    observations.push({ kind, atomic, args, input, before, after, calls, mutations, typedError, result: output, rejected: rejected ? { sameReason: rejected === reason, code: rejected.code, message: rejected.message } : null });
  }
}
assert.equal(observations.length, 22);
console.log(JSON.stringify({ entry, plainNodePublicPackage: true, checks: observations.length, observations, limitation: "Memory-backed deterministic injected races only; no global remote atomicity claim. Error preservation differs from GNU's ignored native prune failures." }, null, 2));
