import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError, type ErrnoCode } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

class FaultFileSystem extends MemoryFileSystem {
  constructor(readonly failure: FsError) { super(); }

  override async stat(...args: Parameters<MemoryFileSystem["stat"]>): ReturnType<MemoryFileSystem["stat"]> {
    if (args[0] === "/blocked") throw this.failure;
    return super.stat(...args);
  }

  override async access(...args: Parameters<MemoryFileSystem["access"]>): ReturnType<MemoryFileSystem["access"]> {
    if (args[0] === "/blocked") throw this.failure;
    return super.access(...args);
  }
}

const descriptions: Readonly<Partial<Record<ErrnoCode, string>>> = {
  ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted",
  ENOTDIR: "Not a directory", EISDIR: "Is a directory", ELOOP: "Too many levels of symbolic links",
  ENOSPC: "No space left on device", EROFS: "Read-only file system",
};

for (const [code, description] of Object.entries(descriptions) as [ErrnoCode, string][]) {
  test(`FsError ${code}: typed API and plugin boundaries retain identity; cd display is native CLI`, async () => {
    const cause = new Error("provider detail");
    const failure = Object.freeze(new FsError(code, { syscall: "stat", path: "/blocked", dest: "/other", message: "provider explanation", cause }));
    const metadata = Object.getOwnPropertyDescriptors(failure);
    const fs = new FaultFileSystem(failure);
    const shell = new Shell({ fs });
    const observed: unknown[] = [];
    shell.use({ name: "typed-failure", setup(host) {
      host.commands.register({ name: "inspect", async execute(context) { await context.fs.stat("/blocked", { signal: context.signal }); return { exitCode: 0 }; } });
      host.commands.register({ name: "forward", async execute(context) { return context.invoke!("inspect", []); } });
    } });
    shell.use(async (_context, next) => {
      try { return await next(); }
      catch (error) { observed.push(error); assert.equal(error, failure); throw error; }
    });
    try {
      await assert.rejects(fs.stat("/blocked"), error => error instanceof FsError && error === failure && error.code === code && error.cause === cause);
      const command = await shell.exec("inspect");
      assert.equal(command.exitCode, 1);
      assert.equal(command.stderr, `shell: line 1: ${failure.message}\n`);
      const forwarded = await shell.exec("forward");
      assert.equal(forwarded.exitCode, 1);
      assert.equal(forwarded.stderr, command.stderr);
      const builtin = await shell.exec("cd blocked");
      assert.equal(builtin.exitCode, 1);
      assert.equal(builtin.stdout, "");
      assert.equal(builtin.stderr, `shell: line 1: cd: blocked: ${description}\n`);
      assert.deepEqual(observed, [failure, failure, failure]);
      assert.deepEqual(Object.getOwnPropertyDescriptors(failure), metadata);
      assert.equal((await shell.exec("pwd")).stdout, "/\n");
      assert.deepEqual(await fs.readdir("/"), []);
    } finally { await shell.dispose(); }
  });

  test(`FsError ${code}: redirection display does not rewrite API errors or filesystem effects`, async () => {
    const failure = Object.freeze(new FsError(code, { syscall: "access", path: "/blocked" }));
    const metadata = Object.getOwnPropertyDescriptors(failure);
    const fs = new FaultFileSystem(failure);
    const shell = new Shell({ fs });
    try {
      await assert.rejects(fs.access("/blocked"), error => error instanceof FsError && error === failure && error.code === code);
      const result = await shell.exec(": <blocked");
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `shell: line 1: blocked: ${description}\n`);
      assert.deepEqual(Object.getOwnPropertyDescriptors(failure), metadata);
      assert.deepEqual(await fs.readdir("/"), []);
    } finally { await shell.dispose(); }
  });
}

test("plugin-provided CLI bytes and arbitrary code-like errors are not rewritten", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.register({ name: "literal", async execute({ stderr }) { await stderr.write(Buffer.from("tool: EACCES: extra context\0\n")); return { exitCode: 7 }; } });
  shell.register({ name: "arbitrary", execute() { throw Object.assign(new Error("ENOENT: not a filesystem operation; retain this context"), { code: "ENOENT" }); } });
  try {
    const literal = await shell.exec("literal");
    assert.equal(literal.exitCode, 7);
    assert.deepEqual(literal.stderrBytes, Uint8Array.from(Buffer.from("tool: EACCES: extra context\0\n")));
    const arbitrary = await shell.exec("arbitrary");
    assert.equal(arbitrary.exitCode, 1);
    assert.equal(arbitrary.stderr, "shell: line 1: ENOENT: not a filesystem operation; retain this context\n");
  } finally { await shell.dispose(); }
});

test("middleware replacement of a cd error retains the replacement diagnostic", async () => {
  const fs = new FaultFileSystem(new FsError("ENOENT", { path: "/blocked" }));
  const shell = new Shell({ fs });
  shell.use(async (_context, next) => {
    try { return await next(); }
    catch (cause) { throw new Error("host policy refused cd", { cause }); }
  });
  try { assert.equal((await shell.exec("cd blocked")).stderr, "shell: line 1: host policy refused cd\n"); }
  finally { await shell.dispose(); }
});

test("filesystem factory and plugin setup failures retain public FsError identity", async () => {
  const failure = new FsError("EACCES", { path: "/provider", syscall: "connect" });
  const factoryShell = new Shell({ fs: new MemoryFileSystem() });
  factoryShell.registerFileSystem("fault", () => { throw failure; });
  try { await assert.rejects(factoryShell.createFileSystem("fault"), error => error === failure); }
  finally { await factoryShell.dispose(); }
  const pluginShell = new Shell({ fs: new MemoryFileSystem() });
  pluginShell.use({ name: "fault", setup() { throw failure; } });
  try { await assert.rejects(pluginShell.exec(":"), error => error === failure); }
  finally { await pluginShell.dispose(); }
});

test("cancellation reason remains a typed FsError, not a formatted CLI result", async () => {
  const failure = new FsError("ECANCELED", { path: "/blocked" });
  const controller = new AbortController();
  const shell = new Shell({ fs: new MemoryFileSystem() });
  shell.register({ name: "cancel", execute() { controller.abort(failure); throw failure; } });
  try { await assert.rejects(shell.exec("cancel", { signal: controller.signal }), error => error === failure); }
  finally { await shell.dispose(); }
});
