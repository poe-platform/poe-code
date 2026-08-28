import assert from "node:assert/strict";
import test from "node:test";
import { createWhichCommand, createWhichCommands, whichCommands } from "../../../src/commands/which/index.js";
import { CommandRegistry, FsError, type ErrnoCode, type PluginHost } from "../../../src/contracts/index.js";
import { ReadOnlyFileSystem } from "../../../src/fs/readonly/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { controlled, file, run, seed } from "./helpers.js";

test("internal factories and real registry collision/replacement snapshot", async () => {
  assert.equal(createWhichCommand().name, "which");
  assert.deepEqual(createWhichCommands().map(command => command.name), ["which"]);
  assert.ok(Object.isFrozen(createWhichCommands()));
  const original = { name: "which", execute() { return { exitCode: 41 }; } };
  const host: PluginHost = { commands: new CommandRegistry([original]), use() {}, registerFileSystem() {} };
  assert.throws(() => whichCommands().setup(host), { message: "Command already registered: which" });
  assert.equal(host.commands.get("which")?.execute, original.execute);
  const options = { replace: true, limits: { maxProbes: 1 } };
  const plugin = whichCommands(options);
  options.replace = false;
  options.limits.maxProbes = 20;
  assert.equal(plugin.name, "which-commands");
  await plugin.setup(host);
  assert.notEqual(host.commands.get("which")?.execute, original.execute);
});

test("first hits, all hits, duplicate operands, misses and quiet bundles", async () => {
  const fs = await seed();
  for (const [args, expected, status] of [
    [["p"], "/a/p\n", 0],
    [["-aa", "-a", "p", "p"], "/a/p\n/b/p\n/a/p\n/b/p\n", 0],
    [["q", "p", "q"], "/a/p\n", 1],
    [["-sas", "-ss", "p"], "", 0],
    [["-sa", "p", "q"], "", 1],
    [[""], "", 1],
  ] as const) {
    const result = await run(args, {}, { fs });
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, status);
  }
});

test("literal stop-at-operand grammar, dash and terminator", async () => {
  const fs = await seed();
  for (const args of [["p", "-a", "--"], ["--", "p", "-a", "--"]]) {
    const result = await run(args, {}, { fs, env: { PATH: "" } });
    assert.equal(result.stdout, "./p\n./-a\n./--\n");
    assert.equal(result.exitCode, 0);
  }
  assert.equal((await run(["-"], {}, { fs, env: { PATH: "" } })).stdout, "./-\n");
});

test("usage and first illegal Unicode option are a single diagnostic", async () => {
  const { fs, calls } = controlled();
  for (const args of [[], ["--"], ["-as"], ["-s", "-aa"]]) {
    const result = await run(args, {}, { fs });
    assert.equal(result.stderr, "usage: which [-as] program ...\n");
    assert.equal(result.exitCode, 1);
    assert.equal(result.diagnostics.length, 1);
  }
  for (const [token, unknown] of [["--help", "-"], ["-azs", "z"], ["-sa😀z", "😀"], ["-é", "é"], ["-\ud800", "�"]]) {
    const result = await run([token!, "p"], {}, { fs });
    assert.equal(result.stderr, `which: illegal option -- ${unknown}\nusage: which [-as] program ...\n`);
    assert.equal(result.stdout, "");
    assert.equal(result.diagnostics.length, 1);
  }
  assert.deepEqual(calls, []);
});

test("absent PATH misses even slash operands; empty and duplicate components retain spelling", async () => {
  const { fs, calls } = controlled();
  assert.equal((await run(["/a/p", "p"], {}, { fs, env: {} })).exitCode, 1);
  assert.deepEqual(calls, []);
  const result = await run(["-a", "p"], {}, { fs, cwd: "/v/", env: { PATH: ":/a/:/a::rel:" } });
  assert.equal(result.stdout, "./p\n/a//p\n/a/p\n./p\nrel/p\n./p\n");
  assert.deepEqual(calls, [
    "stat /v//./p", "access /v//./p", "stat /a//p", "access /a//p",
    "stat /a/p", "access /a/p", "stat /v//./p", "access /v//./p",
    "stat /v//rel/p", "access /v//rel/p", "stat /v//./p", "access /v//./p",
  ]);
  assert.equal((await run(["p"], {}, { fs, cwd: "/", env: { PATH: "/" } })).stdout, "//p\n");
});

test("slash operands are considered once and directory suffixes never stat", async () => {
  const { fs, calls } = controlled();
  const result = await run(["-a", "rel//p", "/a//p", "p/", "p/.", "p/.."], {}, { fs });
  assert.equal(result.stdout, "rel//p\n/a//p\n");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(calls, ["stat /v/rel//p", "access /v/rel//p", "stat /a//p", "access /a//p"]);
});

test("actual memory symlinks follow; dangling/loop/nonregular entries miss", async () => {
  const fs = await seed();
  await fs.symlink("/a/p", "/a/link");
  await fs.symlink("/missing", "/a/dangling");
  await fs.symlink("/a/loop", "/a/loop");
  await fs.mkdir("/a/directory");
  const result = await run(["link", "dangling", "loop", "directory"], {}, { fs });
  assert.equal(result.stdout, "/a/link\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 1);
});

test("real readonly memory permits X_OK; effective access overrides mode bits", async () => {
  const memory = await seed();
  const fs = new ReadOnlyFileSystem(memory);
  assert.equal(fs.capabilities.permissions, false);
  assert.equal((await run(["p"], {}, { fs })).stdout, "/a/p\n");
  await memory.chmod("/a/p", 0o001);
  await memory.chmod("/b/p", 0o001);
  assert.equal((await run(["p"], {}, { fs })).exitCode, 1);
  for (const capabilities of [{}, { permissions: false }, { permissions: true, readOnly: true }]) {
    const provider = controlled({ capabilities, async stat() { return { ...file, mode: 0 }; } });
    assert.equal((await run(["p"], {}, { fs: provider.fs })).exitCode, 0);
    assert.deepEqual(provider.calls, ["access /a/p"]);
  }
});

test("nonregular metadata never accesses and metadata is not a mode gate", async () => {
  for (const type of ["directory", "symlink"] as const) {
    const { fs, calls } = controlled({ async stat() { return { ...file, type }; } });
    assert.equal((await run(["p"], {}, { fs })).exitCode, 1);
    assert.deepEqual(calls, []);
  }
  const { fs } = controlled({ async stat() { return { ...file, get mode(): number { throw new Error("mode was read"); } }; } });
  assert.equal((await run(["p"], {}, { fs })).exitCode, 0);
});

test("six typed miss classes at either operation continue; nothing arbitrary is swallowed", async () => {
  const codes: readonly ErrnoCode[] = ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "ELOOP", "ENAMETOOLONG"];
  for (const code of codes) for (const operation of ["stat", "access"] as const) {
    const { fs } = controlled({ [operation]: async (path: string) => {
      if (path.startsWith("/a/")) throw new FsError(code);
      return file;
    } });
    const result = await run(["p"], {}, { fs });
    assert.equal(result.stdout, "/b/p\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  }
});

test("fatal stat/access diagnostics preserve prior bytes, first-hit semantics and quiet failures", async () => {
  for (const operation of ["stat", "access"] as const) for (const [code, description] of [
    ["ENOTSUP", "operation not supported"], ["EROFS", "read-only file system"], ["EIO", "input/output error"],
  ] as const) {
    const { fs } = controlled({ [operation]: async (path: string) => {
      if (path.startsWith("/b/")) throw new FsError(code, { message: "SECRET /host/file", path: "/host/file" });
      return file;
    } });
    assert.equal((await run(["p"], {}, { fs })).exitCode, 0);
    for (const flags of ["-a", "-as"]) {
      const result = await run([flags, "p", "later"], {}, { fs });
      assert.equal(result.stdout, flags === "-a" ? "/a/p\n" : "");
      assert.equal(result.stderr, `which: /b/p: ${description}\n`);
      assert.equal(result.exitCode, 1);
      assert.equal(result.diagnostics.length, 1);
    }
  }
});

test("all remaining typed codes use fixed descriptions; raw/code-shaped failures never leak", async () => {
  const descriptions: Partial<Record<ErrnoCode, string>> = {
    EAGAIN: "resource temporarily unavailable", EBADF: "bad file descriptor", EBUSY: "resource busy or locked",
    ECANCELED: "operation canceled", EEXIST: "file already exists", EFBIG: "file too large", EINTR: "interrupted system call",
    EINVAL: "invalid argument", EISDIR: "illegal operation on a directory", EMFILE: "too many open files",
    ENFILE: "file table overflow", ENOMEM: "not enough memory", ENOSPC: "no space left on device",
    ENOSYS: "function not implemented", ENOTEMPTY: "directory not empty", EOPNOTSUPP: "operation not supported",
    EPIPE: "broken pipe", ETIMEDOUT: "operation timed out", EXDEV: "cross-device link not permitted",
  };
  for (const [code, description] of Object.entries(descriptions)) {
    const error = Reflect.construct(FsError, [code]);
    const { fs } = controlled({ async stat() { throw error; } });
    assert.equal((await run(["p"], {}, { fs })).stderr, `which: /a/p: ${description}\n`);
  }
  for (const failure of [{ code: "ENOENT", message: "SECRET" }, new Error("SECRET"), null, undefined, false, "SECRET", 0]) {
    const { fs } = controlled({ async access() { throw failure; } });
    assert.equal((await run(["p"], {}, { fs })).stderr, "which: /a/p: filesystem operation failed\n");
  }
});

test("actual Shell plugin uses exported invocation PATH, readonly filesystem and byte pipeline", async () => {
  const fs = new ReadOnlyFileSystem(await seed());
  const shell = new Shell({ fs, cwd: "/v", env: { PATH: "/a:/b" } }).use(whichCommands());
  const seen: Uint8Array[] = [];
  shell.commands.register({ name: "capture", async execute(context) {
    for await (const bytes of context.stdin) seen.push(new Uint8Array(bytes));
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec("which p")).stdout, "/a/p\n");
    assert.equal((await shell.exec("PATH=/b which p")).stdout, "/b/p\n");
    assert.equal((await shell.exec("unset PATH; which /a/p")).exitCode, 1);
    assert.equal((await shell.exec("which capture")).exitCode, 1);
    assert.equal((await shell.exec("which -a p | capture")).exitCode, 0);
    assert.equal(Buffer.concat(seen).toString(), "/a/p\n/b/p\n");
  } finally { await shell.dispose(); }
});
