import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem, Shell, ShellLimitError } from "../../src/index.js";
import { writeFileOutput } from "../../src/contracts/filesystem-output.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const outputLimit = (error: unknown) => error instanceof ShellLimitError && error.limit === "maxOutputBytes";

test("direct file output preserves zero-byte truncation at a zero Shell output budget", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/out", Buffer.from("old"));
  const shell = new Shell({ fs });
  let calls = 0;
  shell.register({ name: "write", async execute(context) {
    await writeFileOutput(context, new Uint8Array(), async bytes => {
      calls++;
      await context.fs.writeFile("/out", bytes, { signal: context.signal });
    });
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec("write", { limits: { maxOutputBytes: 0 } })).exitCode, 0);
    assert.equal(calls, 1);
    assert.equal((await fs.stat("/out")).size, 0);
  } finally { await shell.dispose(); }
});

for (const maximum of [3, 4]) {
  test(`direct file output admits four bytes before the host call at Shell limit ${maximum}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", Buffer.from("old"));
    const shell = new Shell({ fs });
    let calls = 0;
    shell.register({ name: "write", async execute(context) {
      await writeFileOutput(context, Uint8Array.of(0, 255, 128, 65), async bytes => {
        calls++;
        await context.fs.writeFile("/out", bytes, { signal: context.signal });
      });
      return { exitCode: 0 };
    } });
    try {
      const work = shell.exec("write", { limits: { maxOutputBytes: maximum } });
      if (maximum === 3) await assert.rejects(work, outputLimit);
      else assert.equal((await work).exitCode, 0);
      assert.equal(calls, maximum === 3 ? 0 : 1);
      assert.deepEqual(await fs.readFile("/out"), maximum === 3 ? Uint8Array.from(Buffer.from("old")) : Uint8Array.of(0, 255, 128, 65));
    } finally { await shell.dispose(); }
  });
}

for (const maximum of [7, 8]) {
  test(`direct file output shares stdout and nested-invocation budget ${maximum}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() });
    const writes: string[] = [];
    shell.register({ name: "child", async execute(context) {
      await writeFileOutput(context, Buffer.from("def"), async bytes => { writes.push(Buffer.from(bytes).toString()); });
      return { exitCode: 0 };
    } });
    shell.register({ name: "parent", async execute(context) {
      await context.stdout.write(Buffer.from("12"));
      await writeFileOutput(context, Buffer.from("abc"), async bytes => { writes.push(Buffer.from(bytes).toString()); });
      return context.invoke!("child", []);
    } });
    try {
      const work = shell.exec("parent", { limits: { maxOutputBytes: maximum } });
      if (maximum === 7) await assert.rejects(work, outputLimit);
      else assert.equal((await work).stdout, "12");
      assert.deepEqual(writes, maximum === 7 ? ["abc"] : ["abc", "def"]);
    } finally { await shell.dispose(); }
  });
}

test("failed direct writes retain their charge but a new exec gets a fresh budget", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  let calls = 0;
  shell.register({ name: "tiny", async execute(context) {
    await writeFileOutput(context, Uint8Array.of(1), async () => { calls++; });
    return { exitCode: 0 };
  } });
  shell.register({ name: "failed", async execute(context) {
    await assert.rejects(writeFileOutput(context, Buffer.from("1234"), async () => { throw false; }), error => error === false);
    return context.invoke!("tiny", []);
  } });
  try {
    await assert.rejects(shell.exec("failed", { limits: { maxOutputBytes: 4 } }), outputLimit);
    assert.equal(calls, 0);
    assert.equal((await shell.exec("tiny", { limits: { maxOutputBytes: 1 } })).exitCode, 0);
    assert.equal(calls, 1);
  } finally { await shell.dispose(); }
});

test("direct command hosts retain their supplied policy without new cleanup registrations", async () => {
  let registrations = 0, total = 0;
  const context = { signal: new AbortController().signal, registerCleanup() { registrations++; } };
  for (let index = 0; index < 3; index++) await writeFileOutput(context, Buffer.from("1234"), async bytes => { total += bytes.length; });
  assert.equal(total, 12);
  assert.equal(registrations, 0);
});

for (const reason of [false, null, 0, ""]) {
  test(`direct file output prioritizes preabort ${JSON.stringify(reason)} before host admission`, async () => {
    const controller = new AbortController();
    controller.abort(reason);
    let calls = 0;
    await assert.rejects(writeFileOutput({ signal: controller.signal }, Buffer.from("x"), async () => { calls++; }), error => Object.is(error, reason));
    assert.equal(calls, 0);
  });

  test(`direct file output preserves synchronous host failure ${JSON.stringify(reason)}`, async () => {
    await assert.rejects(writeFileOutput({ signal: new AbortController().signal }, Buffer.from("x"), () => { throw reason; }), error => Object.is(error, reason));
  });

  for (const rejectHost of [false, true]) {
    test(`direct file output joins an admitted host write after ${JSON.stringify(reason)} cancellation and host ${rejectHost ? "rejection" : "success"}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem() });
      const controller = new AbortController();
      const entered = deferred(), release = deferred();
      let writing!: Promise<void>;
      let settled = false, completed = false;
      shell.register({ name: "write", async execute(context) {
        writing = writeFileOutput(context, Buffer.from("x"), async () => {
          entered.resolve();
          await release.promise;
          completed = true;
          if (rejectHost) throw new Error("late host failure");
        });
        void writing.then(() => { settled = true; }, () => { settled = true; });
        await writing;
        return { exitCode: 0 };
      } });
      const execution = shell.exec("write", { signal: controller.signal, limits: { maxOutputBytes: 1 } });
      void execution.catch(() => {});
      try {
        await entered.promise;
        controller.abort(reason);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(settled, false, "the helper must not abandon its actual host-write promise");
        assert.equal(completed, false);
        release.resolve();
        await assert.rejects(writing, error => Object.is(error, reason));
        await assert.rejects(execution, error => Object.is(error, reason));
        assert.equal(completed, true);
      } finally {
        release.resolve();
        await writing?.catch(() => {});
        await execution.catch(() => {});
        await shell.dispose();
      }
    });
  }
}
