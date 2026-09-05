import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError } from "../../../src/contracts/index.js";
import { commandRuntimeIdentity } from "../../../src/contracts/command.js";
import { Shell } from "../../../src/shell/shell.js";
import { createInstallCommand, createInstallCommands, installCommands } from "../../../src/commands/install/index.js";
import { run, seed, wrapped } from "./helpers.js";

test("every install factory registers only with its matching command runtime", () => {
  const registry = new CommandRegistry();
  installCommands().setup({ commands: registry, use() {}, registerFileSystem() {} });
  const definitions = [createInstallCommand(), ...createInstallCommands(), registry.get("install")!];
  for (const definition of definitions) {
    assert.equal(definition.runtimeIdentity, commandRuntimeIdentity);
    assert.doesNotThrow(() => new CommandRegistry([definition]));
    const otherRuntime = Object.freeze({});
    assert.throws(() => new CommandRegistry([{ ...definition, runtimeIdentity: otherRuntime }]), /do not mix source and compiled runtime modules/u);
  }
});

test("opt-in factories and explicit replacement policy", () => {
  assert.equal(createInstallCommand().name, "install");
  assert.deepEqual(createInstallCommands().map(command => command.name), ["install"]);
  const commands = new CommandRegistry([{ name: "install", execute: () => ({ exitCode: 42 }) }]);
  const original = commands.get("install"), host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => installCommands().setup(host), /already registered/u);
  assert.equal(commands.get("install"), original);
  installCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("install"), original);
});

test("copies exact bytes, replaces destination inode and applies default mode", async () => {
  const fs = await seed();
  await fs.writeFile("/target", Uint8Array.of(1, 2, 3, 4, 5, 6));
  const before = await fs.stat("/target");
  assert.deepEqual(await run(["-v", "source", "target"], fs), { exitCode: 0, stdout: "removed 'target'\n'source' -> 'target'\n", stderr: "" });
  const after = await fs.stat("/target");
  assert.deepEqual(await fs.readFile("/target"), await fs.readFile("/source"));
  assert.equal(after.mode & 0o7777, 0o755);
  assert.notEqual(after.ino, before.ino);
  assert.equal(after.uid, 0);
  assert.equal(after.gid, 0);
});

for (const [mode, fileMode, directoryMode] of [["640", 0o640, 0o640], ["u=rw,g=u,o=g", 0o666, 0o666], ["a+X", 0, 0o111], ["+755", 0o755, 0o755], ["-755", 0, 0], ["=", 0, 0], ["u+x,g+X", 0o110, 0o110]] as const) {
  test(`install mode starts at zero: ${mode}`, async () => {
    const fs = await seed();
    assert.equal((await run(["-m", mode, "source", "target"], fs)).exitCode, 0);
    assert.equal((await fs.stat("/target")).mode & 0o7777, fileMode);
    assert.equal((await run(["-d", "-m", mode, "dir"], fs)).exitCode, 0);
    assert.equal((await fs.stat("/dir")).mode & 0o7777, directoryMode);
  });
}

test("-d and -D create parents as 0755, applying requested mode only to targets", async () => {
  const fs = await seed();
  assert.equal((await run(["-dv", "-m700", "new/sub"], fs)).stdout, "install: creating directory 'new'\ninstall: creating directory 'new/sub'\n");
  assert.equal((await fs.stat("/new")).mode & 0o7777, 0o755);
  assert.equal((await fs.stat("/new/sub")).mode & 0o7777, 0o700);
  assert.equal((await run(["-Dv", "-m600", "source", "path/to/file"], fs)).stdout, "install: creating directory 'path'\ninstall: creating directory 'path/to'\n'source' -> 'path/to/file'\n");
  assert.equal((await fs.stat("/path/to")).mode & 0o7777, 0o755);
  assert.equal((await fs.stat("/path/to/file")).mode & 0o7777, 0o600);
});

test("target directory options, option permutation, -- and source errors", async () => {
  const fs = await seed();
  assert.equal((await run(["source", "-Dt", "new/dir"], fs)).exitCode, 0);
  assert.deepEqual(await fs.readFile("/new/dir/source"), await fs.readFile("/source"));
  assert.equal((await run(["-tnew/dir", "missing", "source"], fs)).exitCode, 1);
  assert.equal((await run(["-T", "source", "new/dir"], fs)).exitCode, 1);
  assert.equal((await run(["--", "source", "-file"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/-file")).size, 5);
});

test("source symlinks are followed; destination links replaced, referent untouched", async () => {
  const fs = await seed();
  await fs.writeFile("/referent", Uint8Array.of(7));
  await fs.symlink!("source", "/input-link");
  await fs.symlink!("referent", "/output-link");
  assert.equal((await run(["input-link", "output-link"], fs)).exitCode, 0);
  assert.equal((await fs.lstat("/output-link")).type, "file");
  assert.deepEqual(await fs.readFile("/referent"), Uint8Array.of(7));
  await fs.symlink!("missing", "/dangling");
  assert.equal((await run(["source", "dangling"], fs)).exitCode, 0);
  await assert.rejects(fs.stat("/missing"), { code: "ENOENT" });
});

test("same directory entry is rejected; distinct hardlink entry is safely replaced", async () => {
  const fs = await seed();
  await fs.link!("/source", "/hard");
  assert.equal((await run(["source", "source"], fs)).stderr, "install: 'source' and 'source' are the same file\n");
  assert.equal((await run(["source", "hard"], fs)).exitCode, 0);
  assert.notEqual((await fs.stat("/hard")).ino, (await fs.stat("/source")).ino);
  assert.equal((await fs.stat("/source")).size, 5);
});

test("simple and numbered backups preserve old bytes and identity", async () => {
  const fs = await seed();
  await fs.writeFile("/target", Uint8Array.of(7, 8));
  const before = await fs.stat("/target");
  assert.equal((await run(["-bv", "source", "target"], fs)).stdout, "'source' -> 'target' (backup: 'target~')\n");
  assert.equal((await fs.stat("/target~")).ino, before.ino);
  assert.deepEqual(await fs.readFile("/target~"), Uint8Array.of(7, 8));
  await fs.writeFile("/target.~2~", Uint8Array.of(9));
  const second = await fs.stat("/target");
  assert.equal((await run(["--backup=existing", "source", "target"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/target.~3~")).ino, second.ino);
  assert.deepEqual(await fs.readFile("/target.~2~"), Uint8Array.of(9));
});

test("suffix enables backups and environment controls backup defaults", async () => {
  const fs = await seed();
  await fs.writeFile("/target", Uint8Array.of(1));
  assert.equal((await run(["-S.old", "source", "target"], fs)).exitCode, 0);
  assert.deepEqual(await fs.readFile("/target.old"), Uint8Array.of(1));
  assert.equal((await run(["-b", "source", "target"], fs, {}, { env: { SIMPLE_BACKUP_SUFFIX: ".save", VERSION_CONTROL: "simple" } })).exitCode, 0);
  assert.equal((await fs.stat("/target.save")).size, 5);
});

test("preserve timestamps uses pre-copy source timestamps", async () => {
  const fs = await seed();
  assert.equal((await run(["-p", "source", "target"], fs)).exitCode, 0);
  const target = await fs.stat("/target");
  assert.equal(target.atimeMs, 1000);
  assert.equal(target.mtimeMs, 2000);
});

test("compare preserves matching inode and modification time but replaces changed content/mode", async () => {
  const fs = await seed();
  await run(["source", "target"], fs);
  const before = await fs.stat("/target");
  assert.equal((await run(["-Cv", "source", "target"], fs)).stdout, "");
  assert.equal((await fs.stat("/target")).ino, before.ino);
  assert.equal((await fs.stat("/target")).mtimeMs, before.mtimeMs);
  await fs.chmod!("/target", 0o644);
  assert.equal((await run(["-C", "source", "target"], fs)).exitCode, 0);
  assert.notEqual((await fs.stat("/target")).ino, before.ino);
});

test("ownership hooks run before chmod; names and numeric IDs resolve explicitly", async () => {
  const fs = await seed(), calls: string[] = [];
  let ownership = { uid: 0, gid: 0 };
  const host = wrapped(fs, {
    async stat(path, options) { return { ...await fs.stat(path, options), ...(path === "/target" ? ownership : {}) }; },
    async chmod(path, mode, options) { calls.push(`chmod:${mode}`); await fs.chmod!(path, mode, options); },
  });
  const result = await run(["-obuilder", "-g0x10", "source", "target"], host, {
    resolveUser: name => name === "builder" ? 42 : undefined,
    async chown(path, uid, gid, context) { assert.equal(path, "/target"); assert.equal(context.fs, host); ownership = { uid: uid ?? ownership.uid, gid: gid ?? ownership.gid }; calls.push(`chown:${uid}:${gid}`); },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, ["chown:42:16", "chmod:493"]);
  assert.equal((await host.stat("/target")).uid, 42);
  assert.equal((await host.stat("/target")).gid, 16);
});

test("strip is a trusted hook; failure removes newly installed file, retaining backup", async () => {
  const fs = await seed();
  await fs.writeFile("/target", Uint8Array.of(9));
  const result = await run(["-bs", "--strip-program=custom-strip", "source", "target"], fs, { async strip(path, program) {
    assert.equal(program, "custom-strip"); assert.equal(path, "/target"); return 1;
  } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /strip process terminated abnormally/u);
  await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
  assert.deepEqual(await fs.readFile("/target~"), Uint8Array.of(9));
});

test("missing capabilities never fabricate ownership or strip success", async () => {
  const fs = await seed();
  for (const args of [["-o1", "source", "target"], ["-s", "source", "target"]]) {
    const result = await run(args, fs);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Operation not supported/u);
    await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
  }
  const host = wrapped(fs, { capabilities: { ...fs.capabilities, permissions: false } });
  assert.equal((await run(["source", "target"], host)).exitCode, 1);
  await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
});

test("exclusive output admission rejects a replacement race without overwriting the racer", async () => {
  const fs = await seed();
  const host = wrapped(fs, { async writeStream(path, source, options) {
    await fs.writeFile(path, Uint8Array.of(77));
    return fs.writeStream!(path, source, options);
  } });
  assert.equal((await run(["source", "target"], host)).exitCode, 1);
  assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(77));
});

test("read-only and provider failures are nonzero; cancellation escapes", async () => {
  const fs = await seed(), controller = new AbortController();
  assert.equal((await run(["source", "target"], wrapped(fs, { capabilities: { ...fs.capabilities, readOnly: true } }))).exitCode, 1);
  const host = wrapped(fs, { async writeStream() { throw new FsError("ENOSPC"); } });
  assert.match((await run(["source", "target"], host)).stderr, /No space left on device/u);
  controller.abort(new Error("cancel install"));
  await assert.rejects(run(["--help"], fs, {}, { signal: controller.signal }), /cancel install/u);
});

test("actual shell opt-in supports executable installation and directory operands", async () => {
  const fs = await seed(), shell = new Shell({ fs }).use(installCommands());
  try { assert.equal((await shell.exec("install -D -m 700 source bin/tool")).exitCode, 0); }
  finally { await shell.dispose(); }
  assert.equal((await fs.stat("/bin/tool")).mode & 0o7777, 0o700);
});

test("source-open failure leaves no new target; backups restore the old identity", async () => {
  for (const backup of [false, true]) {
    const fs = await seed();
    await fs.chmod!("/source", 0);
    await fs.writeFile("/target", Uint8Array.of(9));
    const original = await fs.stat("/target");
    const result = await run([backup ? "-bv" : "-v", "source", "target"], fs);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "install: cannot open 'source' for reading: Permission denied\n");
    if (backup) {
      assert.equal(result.stdout, "'source' -> 'target' (backup: 'target~')\n'target~' -> 'target' (unbackup)\n");
      assert.equal((await fs.stat("/target")).ino, original.ino);
      assert.deepEqual(await fs.readFile("/target"), Uint8Array.of(9));
      await assert.rejects(fs.stat("/target~"), { code: "ENOENT" });
    } else {
      assert.equal(result.stdout, "removed 'target'\n'source' -> 'target'\n");
      await assert.rejects(fs.stat("/target"), { code: "ENOENT" });
    }
  }
});

test("just-created destinations reject repeated sources except numbered backup mode", async () => {
  for (const numbered of [false, true]) {
    const fs = await seed(); await fs.mkdir("/dir");
    const result = await run([...numbered ? ["--backup=numbered"] : [], "-tdir", "source", "source"], fs);
    assert.equal(result.exitCode, numbered ? 0 : 1);
    assert.equal(result.stderr, numbered ? "" : "install: will not overwrite just-created 'dir/source' with 'source'\n");
  }
});

test("directory-only preserve-timestamps does not require an unused timestamp capability", async () => {
  const fs = await seed();
  assert.equal((await run(["-dp", "dir"], wrapped(fs, { utimes: undefined, capabilities: { ...fs.capabilities, timestamps: false } }))).exitCode, 0);
});

test("empty or path-containing backup suffixes use GNU's fallback tilde", async () => {
  for (const suffix of ["", "a/b", "/tmp/"]) {
    const fs = await seed(); await fs.writeFile("/target", Uint8Array.of(8));
    assert.equal((await run(["-S", suffix, "source", "target"], fs)).exitCode, 0);
    assert.deepEqual(await fs.readFile("/target~"), Uint8Array.of(8));
  }
});

test("directory overwrite and missing-parent diagnostics include GNU operands", async () => {
  const fs = await seed(); await fs.mkdir("/dir");
  assert.equal((await run(["-T", "source", "dir"], fs)).stderr, "install: cannot overwrite directory 'dir' with non-directory 'source'\n");
  assert.equal((await run(["source", "missing/"], fs)).stderr, "install: cannot create regular file 'missing/': No such file or directory\n");
});
