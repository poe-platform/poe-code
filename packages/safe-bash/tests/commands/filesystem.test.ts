import assert from "node:assert/strict";
import test from "node:test";
import { dirname, FsError, type FileSystem, type MkdirOptions } from "../../src/contracts/index.js";
import { fixture, run } from "./helpers.js";

async function prefixFixture() {
  const backing = await fixture({ "reports/drafts/note": "draft", "other/note": "other", "explicit/note": "kept", collision: "file" });
  await backing.chmod("/work/reports/drafts", 0o755);
  await backing.chmod("/work/explicit", 0o755);
  await backing.symlink("reports/drafts", "/work/link");
  const explicit = new Set(["/", "/work", "/work/explicit"]);
  const calls: { path: string; options: MkdirOptions | undefined }[] = [];
  const overrides: { -readonly [Key in keyof FileSystem]?: FileSystem[Key] } = {
    capabilities: { ...backing.capabilities, implicitDirectories: true, explicitDirectories: true },
    async mkdir(path, options) {
      calls.push({ path, options });
      options?.signal?.throwIfAborted();
      if (options?.mode !== undefined && overrides.capabilities?.permissions === false) throw new FsError("ENOTSUP", { syscall: "mkdir", path });
      await backing.mkdir(path, options);
      let current = await backing.realpath(path);
      while (true) {
        explicit.add(current);
        if (!options?.recursive || current === "/") break;
        current = dirname(current);
      }
    },
    async rm(path, options) {
      await backing.rm(path, options);
      let current = dirname(path);
      while (!explicit.has(current) && (await backing.readdir(current)).length === 0) {
        await backing.rmdir(current, options);
        current = dirname(current);
      }
    },
  };
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    if (property === "capabilitiesFor") return undefined;
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  return { fs, backing, calls, overrides };
}

test("mkdir -p persists an implicit prefix after its last descendant is removed", async () => {
  const control = await prefixFixture();
  await control.fs.rm("/work/reports/drafts/note");
  await assert.rejects(control.fs.stat("/work/reports/drafts"), { code: "ENOENT" });
  await control.fs.rm("/work/explicit/note");
  assert.equal((await control.fs.stat("/work/explicit")).type, "directory");
  const current = await prefixFixture();
  const created = await run("mkdir", ["-p", "reports/drafts"], { fs: current.fs });
  assert.equal(created.exitCode, 0, created.stderr);
  assert.equal((await run("rm", ["reports/drafts/note"], { fs: current.fs })).exitCode, 0);
  assert.equal((await run("test", ["-d", "reports/drafts"], { fs: current.fs })).exitCode, 0);
  assert.equal((await current.fs.stat("/work/reports")).type, "directory");
  assert.equal(current.calls.length, 1);
  assert.deepEqual(current.calls[0], { path: "/work/reports/drafts", options: { recursive: true, signal: created.context.signal } });
});

for (const operand of ["reports/drafts", "explicit", "link"]) {
  test(`mkdir -pv -m 700 materializes ${operand} silently without changing existing mode`, async () => {
    const current = await prefixFixture();
    current.overrides.capabilities = { ...current.fs.capabilities, permissions: false };
    const result = await run("mkdir", ["-pv", "-m", "700", operand], { fs: current.fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal((await current.fs.stat(`/work/${operand}`)).mode & 0o777, 0o755);
    assert.equal(current.calls.length, 1);
    assert.deepEqual(current.calls[0]!.options, { recursive: true, signal: result.context.signal });
    await current.fs.rm(operand === "explicit" ? "/work/explicit/note" : "/work/reports/drafts/note");
    assert.equal((await current.fs.stat(`/work/${operand}`)).type, "directory");
  });
}

for (const global of [false, true, undefined]) for (const scoped of [false, true, undefined]) {
  test(`mkdir -p uses path-scoped implicitDirectories=${scoped} over global=${global}`, async () => {
    const current = await prefixFixture();
    const capabilities = { ...current.fs.capabilities };
    if (global === undefined) delete capabilities.implicitDirectories;
    else capabilities.implicitDirectories = global;
    current.overrides.capabilities = capabilities;
    const selected = { ...capabilities };
    if (scoped === undefined) delete selected.implicitDirectories;
    else selected.implicitDirectories = scoped;
    const operand = scoped === true ? "reports/drafts" : "explicit";
    const queried: string[] = [];
    current.overrides.capabilitiesFor = async (path, options) => {
      assert.ok(options?.signal);
      queried.push(path);
      return selected;
    };
    const result = await run("mkdir", ["-p", operand], { fs: current.fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(queried.length > 0);
    assert.ok(queried.every(path => path === `/work/${operand}`));
    assert.equal(current.calls.length, scoped === true ? 1 : 0);
  });
}

for (const implicit of [false, undefined]) {
  test(`mkdir -p leaves explicit-only existing directories untouched when implicitDirectories=${implicit}`, async () => {
    const current = await prefixFixture();
    const capabilities = { ...current.fs.capabilities, readOnly: true };
    if (implicit === undefined) delete capabilities.implicitDirectories;
    else capabilities.implicitDirectories = implicit;
    current.overrides.capabilities = capabilities;
    const result = await run("mkdir", ["-pv", "-m", "700", "explicit"], { fs: current.fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(current.calls.length, 0);
    assert.equal((await current.fs.stat("/work/explicit")).mode & 0o777, 0o755);
  });
}

test("mkdir -p preflights all implicit operands without mutation and calls the adapter once per execution", async () => {
  const current = await prefixFixture();
  const queries: { path: string; writes: number }[] = [];
  current.overrides.capabilitiesFor = async path => { queries.push({ path, writes: current.calls.length }); return current.fs.capabilities; };
  const result = await run("mkdir", ["-pv", "reports/drafts", "other"], { fs: current.fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  for (const path of ["/work/reports/drafts", "/work/other"]) assert.ok(queries.some(query => query.path === path && query.writes === 0));
  assert.deepEqual(current.calls.map(call => call.path), ["/work/reports/drafts", "/work/other"]);
});

for (const denied of ["global-readonly", "path-readonly", "recursiveMkdir", "explicitDirectories", "query-error"] as const) {
  test(`mkdir -p ${denied} preflight refusal prevents every operand mutation`, async () => {
    const current = await prefixFixture();
    if (denied === "global-readonly") current.overrides.capabilities = { ...current.fs.capabilities, readOnly: true };
    current.overrides.capabilitiesFor = async path => {
      const capabilities = { ...current.fs.capabilities, readOnly: false };
      if (path === "/work/reports/drafts") {
        if (denied === "path-readonly") capabilities.readOnly = true;
        else if (denied === "recursiveMkdir" || denied === "explicitDirectories") capabilities[denied] = false;
        else if (denied === "query-error") throw new FsError("ENOTSUP", { syscall: "capabilitiesFor", path });
      }
      return capabilities;
    };
    const result = await run("mkdir", ["-p", "new", "reports/drafts"], { fs: current.fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, denied.endsWith("readonly") ? /EROFS/u : /ENOTSUP/u);
    assert.equal(result.stdout, "");
    assert.equal(current.calls.length, 0);
    await assert.rejects(current.fs.stat("/work/new"), { code: "ENOENT" });
    await current.fs.rm("/work/reports/drafts/note");
    await assert.rejects(current.fs.stat("/work/reports/drafts"), { code: "ENOENT" });
  });
}

for (const args of [["reports/drafts"], ["explicit"], ["collision"], ["-p", "collision"]]) {
  test(`mkdir ${args.join(" ")} preserves existing-directory/file EEXIST errors`, async () => {
    const current = await prefixFixture();
    const result = await run("mkdir", args, { fs: current.fs });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /EEXIST/u);
    assert.equal(result.stdout, "");
    assert.equal(current.calls.length, 0);
  });
}

test("mkdir still passes mode and emits verbose output only for absent directories", async () => {
  const current = await prefixFixture();
  const result = await run("mkdir", ["-pv", "-m", "700", "reports/drafts", "new/deep"], { fs: current.fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "mkdir: created directory 'new/deep'\n");
  assert.equal((await current.fs.stat("/work/new/deep")).mode & 0o777, 0o700);
  assert.equal((await current.fs.stat("/work/reports/drafts")).mode & 0o777, 0o755);
  assert.deepEqual(current.calls.map(call => call.options), [
    { recursive: true, signal: result.context.signal },
    { recursive: true, mode: 0o700, signal: result.context.signal },
  ]);
});

test("mkdir preserves ordinary materialization errors and continues with other operands", async () => {
  const current = await prefixFixture();
  const mkdir = current.overrides.mkdir!;
  current.overrides.mkdir = async (path, options) => {
    if (path === "/work/reports/drafts") { current.calls.push({ path, options }); throw new FsError("EACCES", { syscall: "mkdir", path }); }
    await mkdir(path, options);
  };
  const result = await run("mkdir", ["-pv", "reports/drafts", "new"], { fs: current.fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EACCES/u);
  assert.equal(result.stdout, "mkdir: created directory 'new'\n");
  assert.deepEqual(current.calls.map(call => call.path), ["/work/reports/drafts", "/work/new"]);
});

for (const phase of ["preflight", "execution", "mkdir"]) for (const reason of [false, 0, "", null]) {
  test(`mkdir -p preserves ${JSON.stringify(reason)} cancellation during ${phase}`, async () => {
    const current = await prefixFixture();
    const controller = new AbortController();
    let observations = 0;
    current.overrides.stat = async (path, options) => { observations++; return current.backing.stat(path, options); };
    current.overrides.capabilitiesFor = async () => {
      if (phase === "preflight" || phase === "execution" && observations === 2) controller.abort(reason);
      return current.fs.capabilities;
    };
    if (phase === "mkdir") {
      const mkdir = current.overrides.mkdir!;
      current.overrides.mkdir = async (path, options) => { controller.abort(reason); await mkdir(path, options); };
    }
    await assert.rejects(run("mkdir", ["-p", "reports/drafts"], { fs: current.fs, signal: controller.signal }), error => Object.is(error, reason));
    assert.equal(current.calls.length, phase === "mkdir" ? 1 : 0);
    await current.fs.rm("/work/reports/drafts/note");
    await assert.rejects(current.fs.stat("/work/reports/drafts"), { code: "ENOENT" });
  });
}

test("mkdir creates parents and octal modes, reports errors without abandoning other operands", async () => {
  const fs = await fixture({ collision: "data" });
  assert.equal((await run("mkdir", ["-p", "-m", "700", "nested/child"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/nested/child")).mode & 0o777, 0o700);
  const result = await run("mkdir", ["collision", "other"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EEXIST/u);
  assert.equal((await fs.stat("/work/other")).type, "directory");
  assert.equal((await run("mkdir", ["-m", "invalid", "bad"], { fs })).exitCode, 2);
});

test("touch creates without truncation, honors no-create and reference access/modify times", async () => {
  const fs = await fixture({ source: "keep", reference: "ref" });
  await fs.utimes("/work/reference", 123, 456);
  await fs.utimes("/work/source", 11, 22);
  assert.equal((await run("touch", ["-ar", "reference", "source"], { fs })).exitCode, 0);
  const stat = await fs.stat("/work/source");
  assert.equal(stat.atimeMs, 123);
  assert.equal(stat.mtimeMs, 22);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "keep");
  await run("touch", ["-c", "absent"], { fs });
  await assert.rejects(fs.stat("/work/absent"), { code: "ENOENT" });
  await run("touch", ["new"], { fs });
  assert.equal((await fs.stat("/work/new")).size, 0);
});

test("cp handles multiple files, no-clobber and same-inode protection", async () => {
  const fs = await fixture({ first: "one", second: "two", target: "keep" });
  await run("mkdir", ["out"], { fs });
  assert.equal((await run("cp", ["first", "second", "out"], { fs })).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/out/second")), "two");
  await run("cp", ["-n", "first", "target"], { fs });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target")), "keep");
  await fs.link("/work/first", "/work/alias");
  assert.match((await run("cp", ["first", "alias"], { fs })).stderr, /same file/u);
  assert.equal((await run("cp", ["first", "second", "missing-dir"], { fs })).exitCode, 1);
});

test("cp recursively copies trees, preserves nested symlinks and rejects self-descendants", async () => {
  const fs = await fixture({ "source/deep/file": "payload" });
  await fs.symlink("deep/file", "/work/source/link");
  assert.equal((await run("cp", ["-R", "source", "destination"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/destination/link"), "deep/file");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/destination/deep/file")), "payload");
  assert.equal((await run("cp", ["source", "other"], { fs })).exitCode, 1);
  assert.match((await run("cp", ["-R", "source", "source/inside"], { fs })).stderr, /into itself/u);
  await fs.symlink("source", "/work/alias");
  assert.match((await run("cp", ["-R", "source", "alias/inside"], { fs })).stderr, /into itself/u);
  await fs.symlink(".", "/work/source/loop");
  assert.match((await run("cp", ["-RL", "source", "followed"], { fs })).stderr, /ELOOP/u);
});

test("mv renames and honors no-clobber without host filesystem operations", async () => {
  const fs = await fixture({ first: "one", second: "two" });
  await run("mv", ["-n", "first", "second"], { fs });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/second")), "two");
  assert.equal((await run("mv", ["first", "renamed"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/first"), { code: "ENOENT" });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/renamed")), "one");
});

test("rm refuses directories by default, protects root, removes links not targets, and supports force", async () => {
  const fs = await fixture({ "directory/file": "keep" });
  await fs.symlink("directory", "/work/link");
  assert.equal((await run("rm", ["directory"], { fs })).exitCode, 1);
  assert.equal((await run("rm", ["link"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/directory/file")).type, "file");
  assert.equal((await run("rm", ["-rf", "/"], { fs })).exitCode, 1);
  assert.equal((await run("rm", ["-rf", "."], { fs })).exitCode, 1);
  assert.equal((await run("rm", ["-f", "missing"], { fs })).exitCode, 0);
  assert.equal((await run("rm", ["-r", "directory"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/directory"), { code: "ENOENT" });
});

test("rmdir checks directory type and emptiness and supports parent removal", async () => {
  const fs = await fixture({ file: "x", "nonempty/file": "x" });
  assert.match((await run("rmdir", ["file"], { fs })).stderr, /ENOTDIR/u);
  assert.match((await run("rmdir", ["nonempty"], { fs })).stderr, /ENOTEMPTY/u);
  await fs.mkdir("/work/parents/child", { recursive: true });
  assert.equal((await run("rmdir", ["-p", "parents/child"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/parents"), { code: "ENOENT" });
  assert.equal((await fs.stat("/work")).type, "directory");
});

test("ln supports hardlinks and literal relative symbolic targets, replacement and target directories", async () => {
  const fs = await fixture({ source: "data" });
  await fs.mkdir("/work/out");
  assert.equal((await run("ln", ["source", "hard"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/hard")).ino, (await fs.stat("/work/source")).ino);
  assert.equal((await run("ln", ["-s", "../source", "out/symbolic"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/out/symbolic"), "../source");
  assert.equal((await run("ln", ["-sf", "missing", "out/symbolic"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/out/symbolic"), "missing");
  assert.equal((await run("ln", ["source", "out"], { fs })).exitCode, 0);
  assert.equal((await run("ln", ["-f", "missing", "source"], { fs })).exitCode, 1);
  assert.equal((await fs.stat("/work/source")).size, 4);
});

test("readlink and realpath distinguish literal targets, existing and missing paths", async () => {
  const fs = await fixture({ file: "x" });
  await fs.symlink("file", "/work/link");
  assert.equal((await run("readlink", ["-n", "link"], { fs })).stdout, "file");
  assert.equal((await run("readlink", ["-f", "link"], { fs })).stdout, "/work/file\n");
  assert.equal((await run("readlink", ["file"], { fs })).exitCode, 1);
  assert.equal((await run("realpath", ["missing"], { fs })).stdout, "/work/missing\n");
  assert.equal((await run("realpath", ["-e", "missing"], { fs })).exitCode, 1);
  assert.equal((await run("realpath", ["-mz", "absent/deep/file"], { fs })).stdout, "/work/absent/deep/file\0");
  await fs.mkdir("/work/deep/inside", { recursive: true });
  await fs.symlink("deep/inside", "/work/directory-link");
  assert.equal((await run("realpath", ["directory-link/.."], { fs })).stdout, "/work/deep\n");
  assert.match((await run("realpath", ["file/.."], { fs })).stderr, /ENOTDIR/u);
});

test("ls implements hidden names, classification, explicit directories, recursion and long records", async () => {
  const fs = await fixture({ zebra: "z", alpha: "a", ".hidden": "h", "nested/file": "x" });
  await fs.symlink("alpha", "/work/link");
  assert.equal((await run("ls", [], { fs })).stdout, "alpha\nlink\nnested\nzebra\n");
  assert.equal((await run("ls", ["-AF"], { fs })).stdout, ".hidden\nalpha\nlink@\nnested/\nzebra\n");
  assert.equal((await run("ls", ["-d", "nested"], { fs })).stdout, "nested\n");
  assert.match((await run("ls", ["-a"], { fs })).stdout, /^\.\n\.\.\n\.hidden\n/u);
  assert.match((await run("ls", ["-R", "nested"], { fs })).stdout, /^nested:\nfile\n$/u);
  assert.match((await run("ls", ["-l", "link"], { fs })).stdout, /^lrwxrwxrwx .* link -> alpha\n$/u);
  assert.equal((await run("ls", ["--made-up"], { fs })).exitCode, 2);
});
