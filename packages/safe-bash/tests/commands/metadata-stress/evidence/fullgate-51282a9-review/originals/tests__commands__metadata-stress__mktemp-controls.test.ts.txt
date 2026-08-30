import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { FsError, type FileSystem, type MkdirOptions, type WriteFileOptions } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { namespace, oracle, run, snapshot } from "./helpers.js";

test("GNU mktemp template grammar and quiet diagnostics: 24 controls", async context => {
  const root = await namespace(context);
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const templates = ["X", "XX", "XXX", "XXXX", "start.XXXX", "start.XXX.ext", "prefixXXXmoreXXXtail", "XXXX.XX", "XXX/foo", "folder/file.XXX", "./file.XXX", "--suffix=X"];
  for (const template of templates) for (const quiet of [false, true]) {
    const args = [...quiet ? ["-q"] : [], "-u", "--", template];
    const native = oracle("mktemp", args, root);
    const actual = await run("mktemp", args, fs);
    assert.equal(actual.exitCode, native.exitCode, JSON.stringify({ args, native: native.stderr, actual: actual.stderr }));
    assert.equal(Boolean(actual.stderr), Boolean(native.stderr), JSON.stringify(args));
    if (actual.exitCode === 0) {
      assert.equal(actual.stdout.at(-1), 10);
      assert.ok(actual.stdout.length > 3);
    }
  }
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("mktemp 64 concurrent creations reserve distinct names with virtual umasks", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const results = await Promise.all(Array.from({ length: 64 }, async (_unused, index) => {
    const directory = index % 2 === 0;
    const umask = index % 4 === 0 ? 0o200 : 0o022;
    const result = await run("mktemp", [...directory ? ["-d"] : [], "--suffix=.data", "slot.XXXXXX"], fs, { umask });
    assert.equal(result.exitCode, 0, result.stderr);
    const name = result.stdout.toString().trimEnd();
    assert.match(name, /^slot\.[a-zA-Z0-9]{6}\.data$/u);
    const stat = await fs.stat(`/work/${name}`);
    assert.equal(stat.mode & 0o777, (directory ? 0o700 : 0o600) & ~umask);
    assert.equal(stat.type, directory ? "directory" : "file");
    if (directory) assert.deepEqual(await fs.readdir(`/work/${name}`), []);
    else assert.deepEqual(await fs.readFile(`/work/${name}`), new Uint8Array());
    return name;
  }));
  assert.equal(new Set(results).size, 64);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), results.sort());
});

test("mktemp crypto provenance remains node randomInt with no native/host filesystem fallback", async () => {
  const source = await readFile(new URL("../../../src/commands/metadata/mktemp.ts", import.meta.url), "utf8");
  const syntax = ts.createSourceFile("mktemp.ts", source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  const calls: string[] = [];
  function inspect(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) calls.push(node.expression.getText(syntax));
    ts.forEachChild(node, inspect);
  }
  inspect(syntax);
  assert.ok(imports.includes("node:crypto"));
  assert.ok(calls.includes("randomInt"));
  assert.ok(!calls.some(call => ["Math.random", "eval", "Function", "exec", "execSync", "spawn", "spawnSync"].includes(call)));
  assert.ok(!imports.some(specifier => /child_process|node:fs/u.test(specifier)));
  assert.match(source, /alphabet\[randomInt\(alphabet\.length\)\]/u);
});

test("mktemp directory collision retries never delete competing entries", async () => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/work");
  const paths: string[] = [];
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "mkdir") return async (path: string, options?: MkdirOptions) => {
      assert.equal(options?.recursive, false);
      assert.equal(options.mode, 0o700);
      paths.push(path);
      if (paths.length < 3) {
        await target.mkdir(path);
        await target.writeFile(`${path}/competitor`, Uint8Array.of(paths.length));
        throw new FsError("EEXIST", { path });
      }
      await target.mkdir(path, options);
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await run("mktemp", ["-d", "private.XXXXXX"], fs, { limits: { maxAttempts: 3 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(paths.length, 3);
  for (const [index, path] of paths.slice(0, 2).entries()) assert.deepEqual(await backing.readFile(`${path}/competitor`), Uint8Array.of(index + 1));
  assert.deepEqual(await backing.readdir(paths[2]!), []);
  assert.equal((await backing.stat(paths[2]!)).mode & 0o777, 0o700);
  assert.equal((await backing.readdir("/work")).length, 3);
});

test("mktemp post-create cancellation leaves one entry, never unsafe cleanup or retries", async () => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/work");
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { message: "caller cancelled after creation" });
  let writes = 0;
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "writeFile") return async (path: string, bytes: Uint8Array, options?: WriteFileOptions) => {
      assert.equal(options?.signal, controller.signal);
      writes++;
      await target.writeFile(path, bytes, options);
      controller.abort(reason);
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  await assert.rejects(run("mktemp", ["-q", "private.XXXXXX"], fs, {}, { signal: controller.signal }), error => error === reason);
  assert.equal(writes, 1);
  const entries = await backing.readdir("/work");
  assert.equal(entries.length, 1);
  const path = `/work/${entries[0]!.name}`;
  assert.equal((await backing.stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await backing.readFile(path), new Uint8Array());
});

test("mktemp exclusive file creation cannot follow a competing symlink", async () => {
  const backing = new MemoryFileSystem();
  await backing.mkdir("/work");
  await backing.writeFile("/work/sentinel", Uint8Array.of(0, 255, 77), { mode: 0o640 });
  let competitor: string | undefined;
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "writeFile") return async (path: string, bytes: Uint8Array, options?: WriteFileOptions) => {
      assert.equal(options?.flag, "wx");
      if (competitor === undefined) {
        competitor = path;
        await target.symlink("sentinel", path);
      }
      await target.writeFile(path, bytes, options);
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await run("mktemp", ["private.XXXXXX"], fs, { limits: { maxAttempts: 2 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(competitor);
  assert.equal(await backing.readlink(competitor), "sentinel");
  assert.deepEqual(await backing.readFile("/work/sentinel"), Uint8Array.of(0, 255, 77));
  assert.equal((await backing.stat("/work/sentinel")).mode & 0o777, 0o640);
  const created = `/work/${result.stdout.toString().trimEnd()}`;
  assert.notEqual(created, competitor);
  assert.deepEqual(await backing.readFile(created), new Uint8Array());
  assert.equal((await backing.readdir("/work")).length, 3);
});

test("mktemp byte-length and absent VFS TMPDIR failures leave the namespace untouched", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const before = await snapshot(fs);
  for (const args of [[`${"é".repeat(127)}XXX`], ["--suffix=/bad", "file.XXXX"], ["-p", "/absent", "file.XXXX"], []]) {
    const result = await run("mktemp", args, fs, {}, { env: { TMPDIR: "/not-a-host-directory" } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(await snapshot(fs), before);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["work"]);
  }
});
