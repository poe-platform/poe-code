import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname, FsError, type FileSystem, type MkdirOptions } from "../../src/contracts/index.js";
import { fixture, run } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

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

for (const [args, expected] of [
  [["-d", "@0"], 0],
  [["--date=@-1.25"], -1250],
  [["-d2024-01-02T03:04:05Z"], Date.UTC(2024, 0, 2, 3, 4, 5)],
  [["-t", "202401020304.05"], Date.UTC(2024, 0, 2, 3, 4, 5)],
  [["-t", "2401020304"], Date.UTC(2024, 0, 2, 3, 4)],
  [["-t", "6901020304"], Date.UTC(1969, 0, 2, 3, 4)],
] as const) {
  test(`touch ${args.join(" ")} sets explicit timestamps on new and existing files`, async () => {
    const fs = await fixture({ existing: "keep" });
    const result = await run("touch", [...args, "new", "existing"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    for (const name of ["new", "existing"]) {
      const stat = await fs.stat(`/work/${name}`);
      assert.equal(stat.atimeMs, expected);
      assert.equal(stat.mtimeMs, expected);
    }
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/existing")), "keep");
  });
}

test("touch explicit timestamps work through Shell and stat", async () => {
  const shell = new Shell({ fs: await fixture(), cwd: "/work", env: { TZ: "UTC" } }).use(agentCommands());
  try {
    const result = await shell.exec("touch -d @0 output; stat -c %Y output");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "0\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("touch explicit timestamps refuse unsupported timestamp creation before writing", async () => {
  const backing = await fixture();
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "capabilitiesFor") return undefined;
    if (property === "capabilities") return { ...backing.capabilities, timestamps: false };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await run("touch", ["-d", "@0", "new"], { fs });
  assert.equal(result.exitCode, 1);
  await assert.rejects(backing.stat("/work/new"), { code: "ENOENT" });
  assert.equal((await run("touch", ["-c", "-d", "@0", "new"], { fs })).exitCode, 0);
});

test("touch explicit timestamps honor TZ, selected times, no-create, and reference-relative dates", async () => {
  const fs = await fixture({ existing: "keep", reference: "" });
  await fs.utimes("/work/existing", 1000, 2000);
  await fs.utimes("/work/reference", 3000, 4000);
  assert.equal((await run("touch", ["-a", "-t", "202401020304.05", "existing"], { fs, env: { TZ: "UTC-2" } })).exitCode, 0);
  assert.equal((await fs.stat("/work/existing")).atimeMs, Date.UTC(2024, 0, 2, 1, 4, 5));
  assert.equal((await fs.stat("/work/existing")).mtimeMs, 2000);
  assert.equal((await run("touch", ["-mr", "reference", "-d", "1 second", "existing"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/existing")).mtimeMs, 5000);
  assert.equal((await run("touch", ["-c", "-d", "@0", "absent"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/absent"), { code: "ENOENT" });
});

for (const args of [["-d", "invalid"], ["-t", "202402300304"], ["-t", "202401020304.99"], ["-t", "123"], ["-d", "@0", "-t", "202401020304"]]) {
  test(`touch rejects ${args.join(" ")} before creating files`, async () => {
    const fs = await fixture();
    const result = await run("touch", [...args, "new"], { fs });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.match(result.stderr, /^touch: /);
    await assert.rejects(fs.stat("/work/new"), { code: "ENOENT" });
  });
}

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

for (const [source, target] of [
  ["input", "output"],
  ["./input", "./output"],
  ["nested/../input", "nested/../output"],
  ["/work/input", "/work/output"],
]) {
  test(`cp -v preserves operand spelling for ${source} -> ${target}`, async () => {
    const fs = await fixture({ input: "a", "nested/keep": "kept" });
    const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(agentCommands());
    const result = await shell.exec(`cp -v ${source} ${target}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `'${source}' -> '${target}'\n`);
    assert.deepEqual(await fs.readFile("/work/output"), new TextEncoder().encode("a"));
  });
}

test("cp -v preserves destination directory spelling for multiple operands", async () => {
  const fs = await fixture({ first: "one", second: "two", "out/keep": "kept" });
  const result = await run("cp", ["-v", "./first", "second", "./out//"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "'./first' -> './out/first'\n'second' -> './out/second'\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/out/first")), "one");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/out/second")), "two");
});

test("cp -Rv preserves operand spelling for nested files and symlinks", async () => {
  const fs = await fixture({ "source/deep/file": "payload" });
  await fs.symlink("deep/file", "/work/source/link");
  const result = await run("cp", ["-Rv", "./source/", "./destination"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout.trimEnd().split("\n").sort(), [
    "'./source/' -> './destination'",
    "'./source/deep' -> './destination/deep'",
    "'./source/deep/file' -> './destination/deep/file'",
    "'./source/link' -> './destination/link'",
  ].sort());
  assert.equal(await fs.readlink("/work/destination/link"), "deep/file");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/destination/deep/file")), "payload");
});

test("cp -nv stays silent when skipping an existing destination", async () => {
  const fs = await fixture({ input: "new", output: "kept" });
  const result = await run("cp", ["-nv", "input", "output"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/output")), "kept");
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

test("rmdir --ignore-fail-on-non-empty preserves contents and removes other empty operands", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" });
  await shell.use(agentCommands());
  const result = await shell.exec("mkdir sub empty; touch sub/input; rmdir --ignore-fail-on-non-empty sub empty");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutBytes, new Uint8Array());
  assert.deepEqual(result.stderrBytes, new Uint8Array());
  assert.equal((await fs.stat("/work/sub/input")).type, "file");
  await assert.rejects(fs.stat("/work/empty"), { code: "ENOENT" });
});

test("rmdir --ignore-fail-on-non-empty -p stops at a nonempty parent", async () => {
  const fs = await fixture({ "parents/kept": "data" });
  await fs.mkdir("/work/parents/child/leaf", { recursive: true });
  const result = await run("rmdir", ["--ignore-fail-on-non-empty", "-p", "parents/child/leaf"], { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  await assert.rejects(fs.stat("/work/parents/child"), { code: "ENOENT" });
  assert.deepEqual(await fs.readFile("/work/parents/kept"), new TextEncoder().encode("data"));
});

for (const [operand, code] of [["missing", "ENOENT"], ["file", "ENOTDIR"], ["link", "ENOTDIR"]] as const) {
  test(`rmdir --ignore-fail-on-non-empty preserves ${code} for ${operand}`, async () => {
    const fs = await fixture({ file: "data", "nonempty/file": "kept" });
    await fs.symlink("nonempty", "/work/link");
    await fs.mkdir("/work/empty");
    const result = await run("rmdir", ["--ignore-fail-on-non-empty", "nonempty", operand, "empty"], { fs });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes(code));
    assert.ok(!result.stderr.includes("ENOTEMPTY"));
    assert.equal(result.stdout, "");
    await assert.rejects(fs.stat("/work/empty"), { code: "ENOENT" });
    assert.equal((await fs.stat("/work/nonempty/file")).type, "file");
  });
}

for (const code of ["EACCES", "ENOTSUP", "EROFS", "ENOTEMPTY"] as const) {
  test(`rmdir --ignore-fail-on-non-empty preserves ${code} errors and cancellation`, async () => {
    const fs = await fixture({ "sub/input": "kept" });
    const controller = new AbortController();
    const reason = new FsError(code, { path: "/work/sub" });
    fs.rmdir = async () => { throw reason; };
    const result = await run("rmdir", ["--ignore-fail-on-non-empty", "sub"], { fs });
    assert.equal(result.exitCode, code === "ENOTEMPTY" ? 0 : 1);
    assert.equal(result.stderr === "", code === "ENOTEMPTY");
    fs.rmdir = async () => { controller.abort(reason); throw reason; };
    await assert.rejects(run("rmdir", ["--ignore-fail-on-non-empty", "sub"], { fs, signal: controller.signal }), error => error === reason);
    assert.equal((await fs.stat("/work/sub/input")).type, "file");
  });
}

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

test("realpath strips symlinks and dot components lexically", async () => {
  const fs = await fixture({ input: "a", "deep/inside/file": "x" });
  await fs.symlink("deep/inside", "/work/link");
  await fs.symlink("missing", "/work/dangling");
  await fs.symlink("cycle", "/work/cycle");
  const shell = new Shell({ fs, cwd: "/work" });
  shell.use(agentCommands());
  const reproduced = await shell.exec("realpath -s --relative-to=. input");
  assert.equal(reproduced.exitCode, 0, reproduced.stderr);
  assert.equal(reproduced.stdout, "input\n");
  assert.equal(reproduced.stderr, "");
  for (const option of ["-s", "--strip", "--no-symlinks"]) {
    const result = await run("realpath", [option, "link", "link/../input", "absent/deep", "dangling", "//work///input", "/../../work/input"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "/work/link\n/work/input\n/work/absent/deep\n/work/dangling\n/work/input\n/work/input\n");
    assert.equal(result.stderr, "");
  }
  assert.equal((await run("realpath", ["-s", "cycle"], { fs })).stdout, "/work/cycle\n");
  assert.equal((await run("realpath", ["-sz", "--relative-to=link", "link/file"], { fs })).stdout, "file\0");
  assert.equal((await run("realpath", ["-sm", "--relative-base=absent", "absent/deep", "input"], { fs })).stdout, "deep\n/work/input\n");
  assert.equal((await run("realpath", ["-se", "link"], { fs })).stdout, "/work/link\n");
  assert.equal((await run("realpath", ["-se", "absent/deep"], { fs })).exitCode, 1);
  assert.equal((await run("realpath", ["-se", "dangling"], { fs })).exitCode, 1);
  assert.equal((await run("realpath", ["-se", "link/../input"], { fs })).stdout, "/work/input\n");
  for (const operand of ["input/", "input/..", "absent/../input"]) {
    assert.equal((await run("realpath", ["-se", operand], { fs })).exitCode, 1, operand);
  }
  for (const operand of ["input/child", "input/", "input/..", "absent/../input", "absent/."]) {
    assert.equal((await run("realpath", ["-s", operand], { fs })).exitCode, 1, operand);
  }
  assert.equal((await run("realpath", ["-sm", "input/..", "absent/../input"], { fs })).stdout, "/work\n/work/input\n");
  assert.equal((await run("realpath", ["-s", ""], { fs })).exitCode, 1);
});

test("realpath lexical output bytes match the GNU oracle", async context => {
  const cases = [
    ["-s", "--relative-to=.", "input"],
    ["--strip", "link", "absent/deep", "//work///input"],
    ["-sm", "link/../input", "//work///input/.", "/../../work/input"],
    ["--no-symlinks", "--relative-base=absent", "absent/deep", "input"],
    ["-sz", "--relative-to=link", "link/file", "link"],
    ["-sm", "--relative-to=absent", "absent/deep"],
  ];
  const fs = await fixture({ input: "a", "deep/inside/file": "x" });
  await fs.symlink("deep/inside", "/work/link");
  for (const args of cases) {
    // Absolute virtual paths make lexical resolution independent of host fixtures.
    const nativeArgs = args.map(arg => arg.startsWith("--relative-")
      ? arg.replace("=.", "=/work").replace("=absent", "=/work/absent").replace("=link", "=/work/link")
      : arg.startsWith("-") || arg.startsWith("/") ? arg : `/work/${arg}`);
    const native = spawnSync("realpath", nativeArgs, { timeout: 1000, env: { ...process.env, LC_ALL: "C", TZ: "UTC" } });
    if (native.error && "code" in native.error && native.error.code === "ENOENT") { context.skip("native realpath unavailable"); return; }
    assert.ifError(native.error);
    if (native.status !== 0 && native.stderr.toString().startsWith("realpath: illegal option -- s")) { context.skip("native realpath lacks GNU -s support"); return; }
    const result = await run("realpath", args, { fs });
    assert.equal(result.exitCode, native.status, `${JSON.stringify(nativeArgs)}: ${native.stderr.toString()}`);
    assert.deepEqual(result.stdoutBytes, native.stdout);
    assert.deepEqual(result.stderrBytes, native.stderr);
  }
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
