import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import { FsError } from "../../src/contracts/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const command = "csvlook -I -y 0 -H --max-rows 0 /input.csv";

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
