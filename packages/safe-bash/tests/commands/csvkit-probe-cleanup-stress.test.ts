import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { FsError } from "../../src/contracts/index.js";
import { MockS3Client, S3FileSystem } from "../../src/fs/s3/index.js";
import { WebDavFileSystem } from "../../src/fs/webdav/index.js";
import { MockDav } from "../fs/webdav/mock.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const command = "csvlook -I -y 0 -H --max-rows 0 /input.csv";

for (const backend of ["s3", "webdav"] as const) test(`csvlook zero-row named probe on ${backend} uses bounded reads without descriptors`, async () => {
  const client = new MockS3Client({ buckets: ["bucket"] });
  const dav = new MockDav();
  const fs = backend === "s3"
    ? new S3FileSystem({ bucket: "bucket", transport: client })
    : new WebDavFileSystem({ baseUrl: "https://example.test/dav/", fetch: dav.fetch });
  await fs.writeFile("/changed table.csv", new TextEncoder().encode("ChangedGamma,12\r\nChangedDelta,14\r\n"));
  assert.equal(fs.capabilities.open, false);
  const readStream = fs.readStream!.bind(fs);
  let probes = 0;
  Object.assign(fs, {
    open() { assert.fail("read-only probe must not acquire unsupported descriptors"); },
    readFile() { assert.fail("probe must not collect the whole file"); },
    readStream(path: string, options: Parameters<typeof readStream>[1]) {
      assert.equal(options?.endExclusive, 1);
      probes++;
      return readStream(path, options);
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec('csvlook --snifflimit 0 --no-inference --max-rows 0 --no-header-row "changed table.csv"');
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "||\n|  |\n", stderr: "" });
    assert.equal(probes, 1);
    const missing = await shell.exec(command);
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr, /FileNotFoundError/);
    const directory = await shell.exec("csvlook -I -y 0 -H --max-rows 0 /");
    assert.equal(directory.exitCode, 1);
    assert.match(directory.stderr, /IsADirectoryError/);
  } finally { await shell.dispose(); }
});

for (const synchronous of [false, true]) test(`csvlook probe ${synchronous ? "synchronous" : "asynchronous"} close failure is reported once without rejecting shell.exec`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode("a\nx\n"));
  const open = fs.open.bind(fs);
  let closes = 0;
  Object.assign(fs, {
    async open(...args: Parameters<typeof open>) {
      const descriptor = await open(...args);
      return { ...descriptor, close() {
        closes++;
        const failure = new FsError("EACCES", { path: "/input.csv" });
        if (synchronous) throw failure;
        return descriptor.close().then(() => { throw failure; });
      } };
    },
    readStream() { assert.fail("zero-row probe must not read file contents"); }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec(command, {
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("named probe must not acquire borrowed stdin"); yield new Uint8Array(); } }
    });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr: "PermissionError: [Errno 13] Permission denied: '/input.csv'\n"
    });
    assert.equal(closes, 1);
    assert.equal((await shell.exec("csvcut --version")).exitCode, 0);
  } finally { await shell.dispose(); }
  assert.equal(closes, 1, "disposal must not retry failed close");
});

test("csvlook respects path-specific read capabilities and reports denied bounded probes", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode("a\nx\n"));
  let closes = 0;
  Object.assign(fs, {
    capabilitiesFor: async () => ({ ...fs.capabilities, open: false }),
    open() { assert.fail("path-specific capabilities must override aggregate capabilities"); },
    readStream() { return { [Symbol.asyncIterator]() { return {
      async next(): Promise<IteratorResult<Uint8Array>> { throw new FsError("EACCES", { path: "/input.csv" }); },
      async return() { closes++; return { done: true as const, value: undefined }; }
    }; } }; }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec(command);
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
      status: 1, stdout: "", stderr: "PermissionError: [Errno 13] Permission denied: '/input.csv'\n"
    });
    assert.equal(closes, 1);
  } finally { await shell.dispose(); }
  assert.equal(closes, 1);
});

test("csvlook cancellation drains a pending bounded probe and closes its iterator once", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode("a\nx\n"));
  let announce!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { announce = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  let closes = 0;
  Object.assign(fs, {
    capabilitiesFor: async () => ({ ...fs.capabilities, open: false }),
    readStream() { return { [Symbol.asyncIterator]() { return {
      async next() { announce(); await pending; return { done: false as const, value: new Uint8Array([97]) }; },
      async return() { closes++; release(); return { done: true as const, value: undefined }; }
    }; } }; }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  const caller = new AbortController();
  const reason = new Error("cancel bounded probe");
  const execution = assert.rejects(shell.exec(command, { signal: caller.signal }), failure => failure === reason);
  try {
    await started;
    caller.abort(reason);
    await execution;
    assert.equal(closes, 1);
  } finally { release(); await execution; await shell.dispose(); }
  assert.equal(closes, 1);
});

test("csvlook uses read access when a filesystem has neither descriptors nor streaming", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new Uint8Array());
  const access = fs.access.bind(fs);
  let probes = 0;
  Object.assign(fs, {
    open: undefined, readStream: undefined,
    readFile() { assert.fail("access probe must not collect input"); },
    async access(...args: Parameters<typeof access>) { probes++; assert.equal(args[1], 4); await access(...args); }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec(command);
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "||\n|  |\n", stderr: "" });
    assert.equal(probes, 1);
  } finally { await shell.dispose(); }
});

test("csvlook cancellation drains an admitted probe and its failed close before public settlement", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.csv", new TextEncoder().encode("a\nx\n"));
  const open = fs.open.bind(fs);
  let announceOpen!: () => void, releaseOpen!: () => void;
  const opening = new Promise<void>(resolve => { releaseOpen = resolve; });
  const opened = new Promise<void>(resolve => { announceOpen = resolve; });
  let announceClose!: () => void, releaseClose!: () => void;
  const closing = new Promise<void>(resolve => { releaseClose = resolve; });
  const closeStarted = new Promise<void>(resolve => { announceClose = resolve; });
  let closes = 0;
  Object.assign(fs, { async open(...args: Parameters<typeof open>) {
    const descriptor = await open(...args);
    announceOpen();
    await opening;
    return { ...descriptor, async close() {
      closes++;
      announceClose();
      await closing;
      await descriptor.close();
      throw new Error("secondary canceled probe close failure");
    } };
  } });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  const caller = new AbortController();
  const reason = new Error("cancel admitted probe");
  let settled = false;
  const execution = shell.exec(command, { signal: caller.signal });
  const rejection = assert.rejects(execution, failure => failure === reason).then(() => { settled = true; });
  try {
    await opened;
    caller.abort(reason);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false, "pending cooperative open remains enrolled");
    releaseOpen();
    await closeStarted;
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false, "admitted descriptor close remains enrolled");
    releaseClose();
    await rejection;
    assert.equal(closes, 1);
  } finally { releaseOpen(); releaseClose(); await rejection; await shell.dispose(); }
  assert.equal(closes, 1, "disposal does not repeat canceled close");
});
