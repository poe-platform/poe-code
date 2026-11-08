import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { prCommands } from "../../../src/commands/pr/index.js";
import { createCommandArguments, type ByteSource, type FileSystem } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { nativeCases } from "./native-cases.js";

for (const [name, command, input, maximum, threshold, work] of [
  ["body margin", "pr -t -o2048", "A\n", 256, 2048, 100_000],
  ["header gap", "pr -l11 -w2048", "A\n", 256, 512, 100_000],
  ["expanded input tab", "pr -t -e2048", "\tA\n", 256, 2048, 100_000],
  ["residual output spaces", "pr -t -i1024 -o200", "A\n", 256, 200, 100_000],
  ["footer lines", "pr -l2048", "A\n", 512, 512, 100_000],
  ["work-limited margin", "pr -t -o2048", "A\n", 8192, 2048, 64],
] as const) {
  test(`pr rejects ${name} before over-budget repeated-string allocation`, async context => {
    const repeat = String.prototype.repeat;
    const allocations: number[] = [];
    context.mock.method(String.prototype, "repeat", function (this: string, count: number) {
      if (count >= threshold) allocations.push(count);
      return repeat.call(this, count);
    });
    const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C", TZ: "UTC" } })
      .use(prCommands({ limits: { maxBufferedBytes: maximum, maxWork: work } }));
    try {
      const result = await shell.exec(command, { stdin: input });
      assert.equal(result.exitCode, 1);
      assert.deepEqual(allocations, [], "allocation must follow retained-byte/work admission");
      assert.ok(result.stderr.includes("limit exceeded"), result.stderr);
    } finally { await shell.dispose(); }
  });
}

test("pr nonstreaming stat preflight refuses input before readFile admission", async () => {
  const fs: MemoryFileSystem & Pick<FileSystem, "capabilitiesFor"> = new MemoryFileSystem();
  await fs.writeFile("/input", new Uint8Array(257).fill(65));
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  let reads = 0;
  fs.readFile = async () => { reads++; assert.fail("oversized stat must precede whole-file read"); };
  fs.readStream = () => { assert.fail("streaming profile is disabled"); };
  const shell = new Shell({ fs }).use(prCommands({ limits: { maxBufferedBytes: 512 } }));
  try {
    const result = await shell.exec("pr -t input");
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("buffered input bytes limit exceeded"), result.stderr);
    assert.equal(reads, 0);
  } finally { await shell.dispose(); }
});

test("pr nonstreaming read carries the bounded maxBytes contract", async () => {
  const fs: MemoryFileSystem & Pick<FileSystem, "capabilitiesFor"> = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("A\n"));
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  const original = fs.readFile.bind(fs);
  const admitted: (number | undefined)[] = [];
  fs.readFile = async (path, options) => { admitted.push(options?.maxBytes); return original(path, options); };
  fs.readStream = () => { assert.fail("streaming profile is disabled"); };
  const shell = new Shell({ fs }).use(prCommands({ limits: { maxBufferedBytes: 512, maxInputBytes: 300 } }));
  try {
    const result = await shell.exec("pr -t input");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "A\n");
    assert.deepEqual(admitted, [256]);
  } finally { await shell.dispose(); }
});

test("pr charges expanded tabs even when column truncation discards them", async context => {
  const repeat = String.prototype.repeat;
  let expanded = 0;
  context.mock.method(String.prototype, "repeat", function (this: string, count: number) {
    if (this === " " && count === 2048) expanded += count;
    return repeat.call(this, count);
  });
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(prCommands({ limits: { maxWork: 3000 } }));
  try {
    const result = await shell.exec("pr -t -2 -a -e2048 -w10", { stdin: Buffer.from("\t\n".repeat(20)) });
    assert.ok(expanded <= 3000, `expanded ${expanded} characters with only 3000 admitted work units`);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("work limit exceeded"), result.stderr);
  } finally { await shell.dispose(); }
});

test("pr merged nonstreaming snapshots and copied chunks share retained memory admission", async context => {
  const fs: MemoryFileSystem & Pick<FileSystem, "capabilitiesFor"> = new MemoryFileSystem();
  const input = Buffer.from("A\n".repeat(100));
  await fs.writeFile("/left", input);
  await fs.writeFile("/right", input);
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: false });
  const originalRead = fs.readFile.bind(fs);
  const snapshots = new WeakSet<Uint8Array>();
  let snapshotBytes = 0, copiedBytes = 0;
  let firstWrite: { snapshotBytes: number; copiedBytes: number } | undefined;
  fs.readFile = async (path, options) => {
    const content = await originalRead(path, options);
    snapshots.add(content);
    snapshotBytes += content.length;
    return content;
  };
  const from = Uint8Array.from;
  context.mock.method(Uint8Array, "from", function (source: Iterable<number> | ArrayLike<number>, map?: (value: number, index: number) => number, receiver?: unknown) {
    if (source instanceof Uint8Array && snapshots.has(source)) copiedBytes += source.length;
    return Reflect.apply(from, Uint8Array, [source, map, receiver]) as Uint8Array;
  });
  const shell = new Shell({ fs }).use(prCommands({ limits: { maxBufferedBytes: 512 } }));
  try {
    const result = await shell.exec("pr -t -m left right", { stdout: {
      async write() { firstWrite ??= { snapshotBytes, copiedBytes }; },
    } });
    if (firstWrite) assert.ok(firstWrite.snapshotBytes + firstWrite.copiedBytes <= 512, JSON.stringify(firstWrite));
    else {
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("limit exceeded"), result.stderr);
    }
    assert.deepEqual(Buffer.from(await originalRead("/left")), input);
    assert.deepEqual(Buffer.from(await originalRead("/right")), input);
  } finally { await shell.dispose(); }
});

for (const [limit, maximum, label] of [
  ["maxInputBytes", 3, "input bytes"],
  ["maxLines", 1, "input lines"],
  ["maxOutputBytes", 3, "output bytes"],
] as const) {
  test(`pr ${limit} remains shared across sequential files`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/left", Buffer.from("A\n"));
    await fs.writeFile("/right", Buffer.from("B\n"));
    const shell = new Shell({ fs, env: { LC_ALL: "C", TZ: "UTC" } })
      .use(prCommands({ limits: { [limit]: maximum } }));
    try {
      const result = await shell.exec("pr -t left right");
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(`${label} limit exceeded`), result.stderr);
      if (limit === "maxOutputBytes") assert.ok(result.stdoutBytes.length <= maximum);
      assert.equal(Buffer.from(await fs.readFile("/left")).toString(), "A\n");
      assert.equal(Buffer.from(await fs.readFile("/right")).toString(), "B\n");
    } finally { await shell.dispose(); }
  });
}

test("pr refuses excess file arguments before metadata or input admission", async () => {
  const fs = new MemoryFileSystem();
  let metadata = 0, reads = 0;
  fs.stat = async () => { metadata++; assert.fail("file cap must precede stat"); };
  const source: ByteSource = { async *[Symbol.asyncIterator]() { reads++; yield Uint8Array.of(65, 10); } };
  const shell = new Shell({ fs }).use(prCommands({ limits: { maxFiles: 1 } }));
  try {
    const result = await shell.exec("pr -t first second", { stdin: source });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("file"), result.stderr);
    assert.deepEqual({ metadata, reads }, { metadata: 0, reads: 0 });
  } finally { await shell.dispose(); }
});

for (const limit of ["maxInputBytes", "maxBufferedBytes"] as const) {
  test(`pr ${limit} rejects an oversized source chunk without pulling a successor`, async () => {
    let pulls = 0, returns = 0;
    const source: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { pulls++; return { done: false, value: new Uint8Array(512).fill(65) }; },
      async return() { returns++; return { done: true, value: undefined }; },
    }; } };
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(prCommands({ limits: { [limit]: 256 } }));
    try {
      const result = await shell.exec("pr -t", { stdin: source });
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("bytes limit exceeded"), result.stderr);
      assert.equal(result.stdoutBytes.length, 0);
      assert.equal(pulls, 1);
      assert.equal(returns, 1);
    } finally { await shell.dispose(); }
  });
}

test("pr bounds empty producer chunks and closes the iterator once", async () => {
  let pulls = 0, returns = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { pulls++; return { done: false, value: new Uint8Array() }; },
    async return() { returns++; return { done: true, value: undefined }; },
  }; } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(prCommands({ limits: { maxEmptyChunks: 3 } }));
  try {
    const result = await shell.exec("pr -t", { stdin: source });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("empty input chunks limit exceeded"), result.stderr);
    assert.ok(pulls <= 4);
    assert.equal(returns, 1);
  } finally { await shell.dispose(); }
});

test("pr newline-free zero-width bytes still consume the input line budget", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() })
    .use(prCommands({ limits: { maxLineBytes: 3 } }));
  try {
    const result = await shell.exec("pr -t -2", { stdin: Uint8Array.of(255, 0, 127, 255, 10) });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("input line bytes limit exceeded"), result.stderr);
  } finally { await shell.dispose(); }
});

for (const raw of [false, true]) {
  test(`pr UTF-8 argument-byte cap precedes input admission, raw carrier=${raw}`, async () => {
    let reads = 0;
    const source: ByteSource = { async *[Symbol.asyncIterator]() { reads++; yield Uint8Array.of(65, 10); } };
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(prCommands({ limits: { maxArgumentBytes: 5 } }));
    shell.commands.register({ name: "forward", execute(context) {
      const values = createCommandArguments(["-t", "-h", raw ? shellValueFromBytes(Uint8Array.of(195, 169)) : "é"]);
      return context.invoke!("pr", values.args, { argumentValues: values });
    } });
    try {
      const result = await shell.exec("forward", { stdin: source });
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("argument bytes limit exceeded"), result.stderr);
      assert.equal(reads, 0);
    } finally { await shell.dispose(); }
  });
}

test("pr actual invoke preserves raw C header bytes and caller ownership", async () => {
  const fixture = nativeCases.find(candidate => candidate.name === "header-UTF8-in-C")!;
  const fs = new MemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("A\n"));
  await fs.utimes("/left", 946684800000, 946684800000);
  const title = Buffer.from("é中");
  const values = createCommandArguments(["-l11", "-w40", "-h", shellValueFromBytes(title), "left"]);
  const shell = new Shell({ fs, env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands());
  shell.commands.register({ name: "forward", execute(context) {
    const pending = context.invoke!("pr", values.args, { argumentValues: values });
    title.fill(88);
    return pending;
  } });
  try {
    const result = await shell.exec("forward");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), fixture.stdoutHex);
  } finally { await shell.dispose(); }
});

test("pr charges padding and headers to Shell's output limit", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("A\n"));
  let delivered = 0;
  const shell = new Shell({ fs, env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands());
  try {
    await assert.rejects(shell.exec("pr -l11 input", { limits: { maxOutputBytes: 8 }, stdout: {
      async write(chunk) { delivered += chunk.length; },
    } }), error => error instanceof Error && error.message.includes("maxOutputBytes"));
    assert.ok(delivered <= 8);
    assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "A\n");
  } finally { await shell.dispose(); }
});
