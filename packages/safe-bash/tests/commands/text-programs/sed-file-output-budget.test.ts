import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../../src/shell/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { sedCommand } from "../../../src/commands/text-programs/sed.js";
import { runVirtual } from "./helpers.js";

function fixture(maxOutputBytes: number) {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, limits: { maxOutputBytes } }).use(textProgramCommands({ maxBufferBytes: 64 }));
  return { fs, shell };
}

const outputLimit = (error: unknown): boolean => error instanceof ShellLimitError && error.message.includes("maxOutputBytes");

for (const program of ["w /out", "s/a/b/w /out"]) {
  test(`sed ${program} admits exactly the shared output budget`, async () => {
    const { fs, shell } = fixture(8);
    const result = await shell.exec(`sed -n '${program}'`, { stdin: "abc\nabc\n" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.equal((await fs.readFile("/out")).length, 8);
  });

  test(`sed ${program} rejects before an over-budget append and closes its input`, async () => {
    const { fs, shell } = fixture(8);
    const original = fs.appendFile.bind(fs);
    let appends = 0, closed = false;
    fs.appendFile = async (...args) => { appends++; return original(...args); };
    const stdin = (async function* () {
      try { for (let index = 0; index < 3; index++) yield Buffer.from("abc\n"); }
      finally { closed = true; }
    })();
    await assert.rejects(shell.exec(`sed -n '${program}'`, { stdin }), outputLimit);
    assert.equal(appends, 2);
    assert.equal(closed, true);
    assert.equal((await fs.readFile("/out")).length, 8);
  });
}

test("sed file destinations share capacity and retain eager empty truncation", async () => {
  const { fs, shell } = fixture(4);
  await fs.writeFile("/second", Buffer.from("old"));
  await assert.rejects(shell.exec("sed -n -e 'w /first' -e 'w /second'", { stdin: "abc\n" }), outputLimit);
  assert.equal(Buffer.from(await fs.readFile("/first")).toString(), "abc\n");
  assert.equal((await fs.readFile("/second")).length, 0);
});

test("sed stdout and file writes consume the same capacity in execution order", async () => {
  const { fs, shell } = fixture(4);
  await assert.rejects(shell.exec("sed -n -e p -e 'w /out'", { stdin: "abc\n" }), outputLimit);
  assert.equal((await fs.readFile("/out")).length, 0);
});

test("sed zero-byte output preparation still creates and truncates at zero capacity", async () => {
  const { fs, shell } = fixture(0);
  await fs.writeFile("/out", Buffer.from("old"));
  const result = await shell.exec("sed -n -e 'w /out' -e 'w /new'", { stdin: "" });
  assert.equal(result.exitCode, 0);
  assert.equal((await fs.readFile("/out")).length, 0);
  assert.equal((await fs.readFile("/new")).length, 0);
});

test("sed in-place replacements share capacity across files without partial replacement", async () => {
  const { fs, shell } = fixture(4);
  await fs.writeFile("/one", Buffer.from("abc\n"));
  await fs.writeFile("/two", Buffer.from("abc\n"));
  const original = fs.writeFile.bind(fs);
  const writes: string[] = [];
  fs.writeFile = async (...args) => { writes.push(args[0]); return original(...args); };
  await assert.rejects(shell.exec("sed -i 's/a/b/' /one /two"), outputLimit);
  assert.deepEqual(writes, ["/one"]);
  assert.equal(Buffer.from(await fs.readFile("/one")).toString(), "bbc\n");
  assert.equal(Buffer.from(await fs.readFile("/two")).toString(), "abc\n");
});

test("sed in-place output admits exact capacity and preserves backup-before-replacement semantics", async () => {
  const { fs, shell } = fixture(8);
  for (const path of ["/one", "/two"]) await fs.writeFile(path, Buffer.from("abc\n"));
  const result = await shell.exec("sed -i.bak 's/a/b/' /one /two");
  assert.equal(result.exitCode, 0);
  for (const path of ["/one", "/two"]) {
    assert.equal(Buffer.from(await fs.readFile(path)).toString(), "bbc\n");
    assert.equal(Buffer.from(await fs.readFile(path + ".bak")).toString(), "abc\n");
  }
});

test("sed in-place output and explicit file output share capacity", async () => {
  const { fs, shell } = fixture(4);
  await fs.writeFile("/input", Buffer.from("abc\n"));
  await assert.rejects(shell.exec("sed -i -e 's/a/b/' -e 'w /out' /input"), outputLimit);
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "bbc\n");
  assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "abc\n");
});

test("sed awaited appends remain visible to subsequent script reads", async () => {
  const { fs, shell } = fixture(8);
  const result = await shell.exec("sed -n -e 'w /out' -e 'r /out'", { stdin: "abc\n" });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "abc\n");
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "abc\n");
});

test("sed direct command hosts retain their existing host-owned limits", async () => {
  const result = await runVirtual("sed", { args: ["-n", "w out"], stdin: "abc\nabc\nabc\n" }, { maxBufferBytes: 8 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.files.out!.length, 12);
});

test("sed direct file output keeps raw bytes and its existing newline for unterminated records", async () => {
  const { fs, shell } = fixture(3);
  const result = await shell.exec("sed -n 'w /out'", { stdin: Uint8Array.of(0, 255) });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(0, 255, 10));
});

test("sed failed append is not retried and preserves its completed prefix", async () => {
  const { fs, shell } = fixture(1024);
  const original = fs.appendFile.bind(fs);
  let appends = 0, closed = false;
  fs.appendFile = async (...args) => {
    if (++appends === 2) throw new Error("injected append failure");
    return original(...args);
  };
  const stdin = (async function* () {
    try { for (let index = 0; index < 3; index++) yield Buffer.from("abc\n"); }
    finally { closed = true; }
  })();
  const result = await shell.exec("sed -n 'w /out'", { stdin });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "sed: injected append failure\n");
  assert.equal(appends, 2);
  assert.equal(closed, true);
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "abc\n");
});

test("sed command keeps its admitted append lifetime after Shell cancellation", async () => {
  const { fs, shell } = fixture(8);
  const controller = new AbortController();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let appends = 0, commandSettled = false, writerSettled = false;
  let commandDone: Promise<void> | undefined;
  const definition = sedCommand({ maxBufferBytes: 64 });
  shell.use({ name: "observe-sed-command-lifetime", setup(host) {
    host.commands.register({ ...definition, execute(context) {
      const work = Promise.resolve(definition.execute(context));
      commandDone = work.then(() => { commandSettled = true; }, () => { commandSettled = true; });
      return work;
    } }, { replace: true });
  } });
  fs.appendFile = async (_path, _bytes, options) => {
    appends++;
    entered();
    try { await gate; options!.signal!.throwIfAborted(); }
    finally { writerSettled = true; }
  };
  const running = shell.exec("sed -n 'w /out'", { stdin: "abc\nabc\n", signal: controller.signal });
  const result = running.then(() => ({ rejected: false, reason: undefined }), reason => ({ rejected: true, reason }));
  try {
    await started;
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    // The Shell may stop waiting for opaque host work, but the underlying
    // command must not release its input or continue while this write is live.
    assert.equal(commandSettled, false);
    assert.equal(writerSettled, false);
  } finally { release(); }
  assert.deepEqual(await result, { rejected: true, reason: false });
  await commandDone;
  assert.equal(commandSettled, true);
  assert.equal(writerSettled, true);
  assert.equal(appends, 1);
});

for (const reason of [null, false, 0, ""]) {
  test(`sed file output preserves falsey cancellation and input cleanup: ${JSON.stringify(reason)}`, async () => {
    const { fs, shell } = fixture(16);
    const controller = new AbortController();
    const original = fs.appendFile.bind(fs);
    let appends = 0, closed = false;
    fs.appendFile = async (...args) => {
      if (++appends === 2) { controller.abort(reason); args[2]!.signal!.throwIfAborted(); }
      return original(...args);
    };
    const stdin = (async function* () {
      try { for (let index = 0; index < 3; index++) yield Buffer.from("abc\n"); }
      finally { closed = true; }
    })();
    await assert.rejects(shell.exec("sed -n 'w /out'", { stdin, signal: controller.signal }), error => Object.is(error, reason));
    assert.equal(appends, 2);
    assert.equal(closed, true);
    assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "abc\n");
  });
}
