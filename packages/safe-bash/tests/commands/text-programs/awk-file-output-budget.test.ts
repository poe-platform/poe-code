import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { CommandRegistry, FsError, MemoryFileSystem, Shell, createStandardCommands, createTextProgramCommands, toByteSource } from "../../../src/index.js";

function fixture(context: TestContext, maxOutputBytes = 4) {
  const fs = new MemoryFileSystem();
  const writes: { operation: string; path: string; length: number; flag: string | undefined }[] = [];
  const writeFile = fs.writeFile.bind(fs), appendFile = fs.appendFile.bind(fs);
  fs.writeFile = async (path, data, options) => {
    writes.push({ operation: "write", path, length: data.length, flag: options?.flag });
    await writeFile(path, data, options);
  };
  fs.appendFile = async (path, data, options) => {
    writes.push({ operation: "append", path, length: data.length, flag: undefined });
    await appendFile(path, data, options);
  };
  const commands = new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands({ maxBufferBytes: 16, maxSteps: 10_000 })]);
  const shell = new Shell({ fs, commands, limits: { maxOutputBytes } });
  context.after(() => shell.dispose());
  return { fs, shell, writes, commands };
}

for (const operator of [">", ">>"]) {
  test(`awk ${operator} accepts the exact shared output budget`, async context => {
    const { fs, shell, writes } = fixture(context);
    await fs.writeFile("/out", Buffer.from("seed"));
    writes.length = 0;
    const result = await shell.exec(`awk 'BEGIN { for(i=0;i<2;i++) print "x" ${operator} "/out" }'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(Buffer.from(await fs.readFile("/out")).toString(), `${operator === ">>" ? "seed" : ""}x\nx\n`);
    assert.deepEqual(writes, [
      { operation: "write", path: "/out", length: 2, flag: operator === ">>" ? "a" : "w" },
      { operation: "append", path: "/out", length: 2, flag: undefined },
    ]);
  });
  test(`awk ${operator} refuses a whole excess write before filesystem effects`, async context => {
    const { fs, shell, writes } = fixture(context, 3);
    await assert.rejects(shell.exec(`awk 'BEGIN { for(i=0;i<2;i++) print "x" ${operator} "/out" }'`), { limit: "maxOutputBytes" });
    assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "x\n");
    assert.equal(writes.length, 1);
    assert.equal(writes[0]!.length, 2);
  });
}

test("awk stdout and named destinations share one budget before target creation", async context => {
  const { fs, shell, writes } = fixture(context);
  const output: Uint8Array[] = [];
  await assert.rejects(shell.exec('awk \'BEGIN { print "x"; print "x" > "/a"; print "x" > "/b" }\'', {
    stdout: { async write(chunk) { output.push(chunk.slice()); } },
  }), { limit: "maxOutputBytes" });
  assert.equal(Buffer.concat(output).toString(), "x\n");
  assert.equal(Buffer.from(await fs.readFile("/a")).toString(), "x\n");
  await assert.rejects(fs.stat("/b"), error => error instanceof FsError && error.code === "ENOENT");
  assert.deepEqual(writes.map(write => write.path), ["/a"]);
});

test("awk cumulative admission spans multiple file names", async context => {
  const { fs, shell, writes } = fixture(context);
  await assert.rejects(shell.exec('awk \'BEGIN { print "x" > "/a"; print "x" > "/b"; print "x" > "/c" }\''), { limit: "maxOutputBytes" });
  assert.deepEqual(writes.map(write => write.path), ["/a", "/b"]);
  await assert.rejects(fs.stat("/c"), error => error instanceof FsError && error.code === "ENOENT");
});

test("awk close and repeated overwrite do not refund charged bytes", async context => {
  const { fs, shell, writes } = fixture(context);
  await assert.rejects(shell.exec('awk \'BEGIN { for(i=0;i<3;i++) { print "x" > "/out"; close("/out") } }\''), { limit: "maxOutputBytes" });
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "x\n");
  assert.deepEqual(writes.map(write => [write.operation, write.flag, write.length]), [["write", "w", 2], ["write", "w", 2]]);
});

test("awk nested function invocations retain the enclosing execution budget", async context => {
  const { fs, shell, writes } = fixture(context);
  await assert.rejects(shell.exec('f() { awk \'BEGIN { print "x" > "/out" }\'; }; f; f; f'), { limit: "maxOutputBytes" });
  assert.equal(writes.length, 2);
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "x\n");
});

test("awk output allowance resets for a new Shell exec", async context => {
  const { shell, writes } = fixture(context, 2);
  for (let index = 0; index < 2; index++) {
    const result = await shell.exec('awk \'BEGIN { print "x" > "/out" }\'');
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.equal(writes.length, 2);
});

test("awk completed named writes remain visible to subsequent getline", async context => {
  const { shell } = fixture(context, 4);
  const result = await shell.exec('awk \'BEGIN { print "x" > "/out"; getline value < "/out"; print value }\'');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "x\n");
});

test("awk named output preserves exact raw bytes", async context => {
  const { shell, fs } = fixture(context);
  const bytes = Buffer.from([255, 0, 254, 10]);
  const result = await shell.exec('awk \'{ print > "/out" }\'', { stdin: bytes });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Buffer.from(await fs.readFile("/out")), bytes);
});

test("awk empty formatted output still creates or truncates its target", async context => {
  const { shell, fs, writes } = fixture(context);
  await fs.writeFile("/existing", Buffer.from("seed"));
  writes.length = 0;
  const result = await shell.exec('awk \'BEGIN { printf "" > "/new"; printf "" > "/existing" }\'');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.readFile("/new")).length, 0);
  assert.equal((await fs.readFile("/existing")).length, 0);
  assert.deepEqual(writes.map(write => [write.length, write.flag]), [[0, "w"], [0, "w"]]);
});

test("awk direct command hosts retain responsibility for their own output quota", async () => {
  const fs = new MemoryFileSystem();
  const definition = createTextProgramCommands({ maxBufferBytes: 8 }).find(command => command.name === "awk")!;
  const result = await definition.execute({
    command: "awk", args: ['BEGIN { for(i=0;i<4;i++) print "x" > "/out" }'], fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() { assert.fail("unexpected stdout"); } },
    stderr: { async write() { assert.fail("unexpected stderr"); } },
  });
  assert.equal(result.exitCode, 0);
  assert.equal((await fs.readFile("/out")).length, 8);
});

for (const reason of [false, null, 0, ""]) test(`awk file output preserves falsey pre-abort ${JSON.stringify(reason)}`, async context => {
  const { shell, writes } = fixture(context);
  await assert.rejects(shell.exec('awk \'BEGIN { print "x" > "/out" }\'', { signal: AbortSignal.abort(reason) }), error => Object.is(error, reason));
  assert.equal(writes.length, 0);
});

test("awk underlying invocation waits for an admitted named write after cancellation", async context => {
  const { shell, fs, commands } = fixture(context);
  const controller = new AbortController();
  let started!: () => void, release!: () => void;
  const admitted = new Promise<void>(resolve => { started = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const writeFile = fs.writeFile.bind(fs);
  let finished = false, settled = false;
  let complete!: () => void;
  const completed = new Promise<void>(resolve => { complete = resolve; });
  const definition = commands.get("awk")!;
  commands.register({ ...definition, async execute(context) {
    try { return await definition.execute(context); }
    finally { settled = true; complete(); }
  } }, { replace: true });
  fs.writeFile = async (path, data, options) => {
    started();
    try { await barrier; await writeFile(path, data, options); }
    finally { finished = true; }
  };
  const running = shell.exec('awk \'BEGIN { print "x" > "/out" }\'', { signal: controller.signal });
  const checked = assert.rejects(running, error => error === false);
  try {
    await admitted;
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false);
    assert.equal(finished, false);
  } finally { release(); }
  await checked;
  await completed;
  assert.equal(finished, true);
});
