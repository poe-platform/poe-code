import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { FsError } from "../../../../src/contracts/errors.js";
import { shellValueFromBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext, ShellExtensionInput } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";

function setup(execute: (context: ShellExtensionContext) => Promise<number>) {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, extensions: [{ name: "diagnostic-descriptor", create: () => ({ builtins: [{ name: "probe", execute }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return { fs, shell };
}

for (const prefix of ["", "command ", "builtin "]) {
  test(`generic diagnostic and descriptor APIs compose through ${prefix || "direct "}dispatch`, async context => {
    const message = Uint8Array.of(255, 0, 128, 239, 191, 189);
    const subject = setup(async invocation => {
      assert.equal(invocation.input.validateOpen(3), undefined);
      assert.equal(invocation.input.validateOpen(4), undefined);
      assert.throws(() => invocation.input.borrow(4), error => error instanceof FsError && error.code === "EBADF");
      await invocation.diagnostic(shellValueFromBytes(message));
      return 7;
    });
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(`:\n${prefix}probe 3>/output 4>&3 2>&4`);
    assert.equal(result.exitCode, 7);
    assert.deepEqual(result.stderrBytes, new Uint8Array());
    assert.deepEqual(result.stdoutBytes, new Uint8Array());
    assert.deepEqual(await subject.fs.readFile("/output"), new Uint8Array([...Buffer.from("shell: line 2: "), ...message, 10]));
  });
}

test("diagnostic awaits one budgeted stderr write before returning to its caller", { timeout: 2000 }, async context => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  let returned = false;
  let writes = 0;
  const subject = setup(async invocation => {
    await invocation.diagnostic(shellValueFromBytes(Uint8Array.of(255)));
    returned = true;
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const pending = subject.shell.exec("probe", { stderr: { async write(bytes) {
    writes++;
    enter();
    assert.deepEqual(bytes, new Uint8Array([...Buffer.from("shell: line 1: "), 255, 10]));
    await released;
  } } });
  void pending.catch(() => {});
  try {
    await entered;
    assert.equal(returned, false);
    assert.equal(writes, 1);
  } finally { release(); }
  assert.equal((await pending).exitCode, 0);
  assert.equal(returned, true);
});

for (const reason of [undefined, null, false, 0, "", new FsError("EPIPE")]) {
  for (const raw of [false, true]) test(`diagnostic preserves exact sink failure: raw=${raw}, ${String(reason)}`, async context => {
    let writes = 0;
    const subject = setup(async invocation => {
      await assert.rejects(invocation.diagnostic(raw ? shellValueFromBytes(Uint8Array.of(255)) : "plain"), error => Object.is(error, reason));
      return 7;
    });
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec("probe", { stderr: { async write() { writes++; throw reason; } } });
    assert.equal(result.exitCode, 7);
    assert.equal(writes, 1);
  });
}

for (const reason of [null, false, 0, ""]) test(`descriptor validation preserves root cancellation precedence: ${String(reason)}`, async context => {
  const controller = new AbortController();
  let validated = 0;
  const subject = setup(async invocation => {
    const { validateOpen } = invocation.input;
    controller.abort(reason);
    for (const descriptor of [0, 1, 2, 9, -1]) {
      assert.throws(() => validateOpen(descriptor), error => Object.is(error, reason));
      validated++;
    }
    return 0;
  });
  context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec("probe", { signal: controller.signal }), error => Object.is(error, reason));
  assert.equal(validated, 5);
});

test("startup descriptor validation uses standard sources without opening or pulling them", async context => {
  let input: ShellExtensionInput | undefined;
  let pulls = 0;
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "startup-descriptors", create: () => ({
    start(invocation) {
      input = invocation.input;
      for (const descriptor of [0, 1, 2]) input.validateOpen(descriptor);
      assert.throws(() => input!.validateOpen(3), error => error instanceof FsError && error.code === "EBADF");
    },
    builtins: [],
  }) }] });
  context.after(() => shell.dispose());
  const result = await shell.exec(":", { stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(255); } } });
  assert.equal(result.exitCode, 0);
  assert.equal(pulls, 0);
  assert.throws(() => input!.validateOpen(0));
});

for (const redirect of ["1>&-", "2>&-", "3>&1 1>&- 3>&-"]) test(`open validation rejects closed output descriptors: ${redirect}`, async context => {
  const descriptor = redirect.startsWith("3") ? 3 : Number(redirect[0]);
  const subject = setup(async invocation => {
    assert.throws(() => invocation.input.validateOpen(descriptor), error => error instanceof FsError && error.code === "EBADF");
    return 0;
  });
  context.after(() => subject.shell.dispose());
  assert.equal((await subject.shell.exec(`probe ${redirect}`)).exitCode, 0);
});
