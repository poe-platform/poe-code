import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { FsError, type FileSystem, type MkdirOptions, type WriteFileOptions } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run, snapshot } from "./helpers.js";

test("mktemp template grammar and quiet diagnostics: 24 controls", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const templates = ["X", "XX", "XXX", "XXXX", "start.XXXX", "start.XXX.ext", "prefixXXXmoreXXXtail", "XXXX.XX", "XXX/foo", "folder/file.XXX", "./file.XXX", "--suffix=X"];
  for (const template of templates) for (const quiet of [false, true]) {
    const args = [...quiet ? ["-q"] : [], "-u", "--", template];
    const actual = await run("mktemp", args, fs);
    const valid = !["X", "XX", "XXXX.XX", "XXX/foo", "--suffix=X"].includes(template);
    assert.equal(actual.exitCode, valid ? 0 : 1, JSON.stringify({ args, actual: actual.stderr }));
    assert.equal(Boolean(actual.stderr), !valid, JSON.stringify(args));
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

test("mktemp uses unbiased Web Crypto with no native/host filesystem fallback", async context => {
  const syntaxes = await Promise.all(["metadata/mktemp.ts", "portable-random.ts"].map(async filename => {
    const source = await readFile(new URL(`../../../src/commands/${filename}`, import.meta.url), "utf8");
    return ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  }));
  const imports: string[] = [];
  const calls: string[] = [];
  const alphabetIndices: ts.Expression[] = [];
  function inspect(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      const regexExec = ts.isPropertyAccessExpression(expression) && ts.isRegularExpressionLiteral(expression.expression) && expression.name.text === "exec";
      if (!regexExec) calls.push(expression.getText());
    }
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "alphabet") alphabetIndices.push(node.argumentExpression);
    ts.forEachChild(node, inspect);
  }
  for (const syntax of syntaxes) inspect(syntax);
  assert.ok(imports.includes("../portable-random.js"));
  assert.ok(calls.includes("globalThis.crypto.getRandomValues"));
  assert.ok(!calls.some(call => ["random", "eval", "Function", "exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork", "require", "createRequire", "getBuiltinModule"].includes(call.split(".").at(-1)!)));
  assert.ok(!imports.some(specifier => specifier.startsWith("node:") || specifier.includes("child_process") || ["fs", "fs/promises", "crypto"].includes(specifier)));
  assert.equal(alphabetIndices.length, 1);
  const index = alphabetIndices[0]!;
  assert.ok(ts.isCallExpression(index));
  assert.equal(index.expression.getText(), "randomInteger");
  assert.deepEqual(index.arguments.map(argument => argument.getText()), ["alphabet.length"]);

  const samples = [4294967295, 4294967292, 62, 25, 26, 51, 52, 61];
  const crypto = globalThis.crypto;
  context.mock.method(crypto, "getRandomValues", function(this: unknown, bytes: Uint32Array) {
    assert.equal(this, crypto);
    assert.ok(bytes instanceof Uint32Array);
    assert.equal(bytes.length, 1);
    assert.ok(samples.length > 0);
    bytes[0] = samples.shift()!;
    return bytes;
  });
  context.mock.method(Math, "random", () => assert.fail("insecure entropy fallback"));
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const result = await run("mktemp", ["private.XXXXXX"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.toString(), "private.azAZ09\n");
  assert.equal(samples.length, 0);
  assert.equal((await fs.stat("/work/private.azAZ09")).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readFile("/work/private.azAZ09"), new Uint8Array());
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
