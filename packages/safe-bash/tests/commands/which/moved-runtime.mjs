import assert from "node:assert/strict";
import test from "node:test";
import { createWhichCommand, whichCommands } from "./dist/commands/which/index.js";
import { createMemoryFileSystem } from "./dist/fs/memory/index.js";
import { ReadOnlyFileSystem } from "./dist/fs/readonly/index.js";
import { Shell } from "./dist/shell/shell.js";

async function fixture() {
  const memory = createMemoryFileSystem();
  await memory.mkdir("/bin");
  await memory.writeFile("/bin/雪", new Uint8Array([255, 0, 128]));
  await memory.chmod("/bin/雪", 0o700);
  return new ReadOnlyFileSystem(memory);
}

function context(fs, overrides = {}) {
  return {
    command: "which", args: ["雪"], env: { PATH: "/bin" }, cwd: "/",
    signal: new AbortController().signal, fs,
    get stdin() { throw new Error("borrowed input acquired"); },
    stdout: { async write() {} }, stderr: { async write() { throw new Error("unexpected diagnostic"); } },
    ...overrides,
  };
}

test("moved compiled direct readonly lookup emits owned UTF-8 bytes", async () => {
  const chunks = [];
  const result = await createWhichCommand().execute(context(await fixture(), {
    stdout: { async write(bytes) { chunks.push(bytes); } },
  }));
  assert.deepEqual(result, { exitCode: 0 });
  assert.deepEqual(chunks, [new TextEncoder().encode("/bin/雪\n")]);
});

test("moved compiled plugin traverses actual Shell byte pipeline", async () => {
  const shell = new Shell({ fs: await fixture(), env: { PATH: "/bin" } }).use(whichCommands());
  const chunks = [];
  shell.commands.register({ name: "consume", async execute(context) {
    for await (const bytes of context.stdin) chunks.push(new Uint8Array(bytes));
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("which 雪 | consume");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from("/bin/雪\n"));
  } finally { await shell.dispose(); }
});

test("moved compiled output honors backpressure and chunk ownership", async () => {
  let release;
  let admit;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { admit = resolve; });
  const chunks = [];
  const operation = createWhichCommand().execute(context(await fixture(), {
    args: ["-a", "雪"], env: { PATH: "/bin:/bin" },
    stdout: { async write(bytes) { chunks.push(bytes); if (chunks.length === 1) { admit(); await gate; } } },
  }));
  await entered;
  assert.equal(chunks.length, 1);
  release();
  assert.equal((await operation).exitCode, 0);
  assert.equal(chunks.length, 2);
  assert.notEqual(chunks[0].buffer, chunks[1].buffer);
  assert.equal(Buffer.concat(chunks).toString(), "/bin/雪\n/bin/雪\n");
});

test("moved compiled cancellation and sink rejection preserve identity", async () => {
  const fs = await fixture();
  const reason = { code: "EACCES", reason: "caller" };
  const controller = new AbortController();
  controller.abort(reason);
  await assert.rejects(() => createWhichCommand().execute(context(fs, { signal: controller.signal })), error => error === reason);
  await assert.rejects(() => createWhichCommand().execute(context(fs, {
    stdout: { async write() { throw reason; } },
  })), error => error === reason);
});
