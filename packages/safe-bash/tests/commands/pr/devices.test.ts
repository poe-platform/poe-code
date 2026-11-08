import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { toByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { createPrCommand, prCommands, type PrLimits } from "../../../src/commands/pr/index.js";

const nativeCases = [
  { name: "null", args: ["-t", "/dev/null"], stdoutHex: "" },
  { name: "symlink", args: ["-t", "null-link"], stdoutHex: "" },
  { name: "merge-left", args: ["-t", "-m", "/dev/null", "-"], stdoutHex: "0909090920202020616c7068610a0909090920202020626574610a" },
  { name: "merge-right", args: ["-t", "-m", "-", "/dev/null"], stdoutHex: "616c70686109090909202020200a6265746109090909202020200a" },
  { name: "merge-separated", args: ["-t", "-m", "-s|", "/dev/null", "-"], stdoutHex: "7c616c7068610a7c626574610a" },
] as const;

for (const fixture of nativeCases) test(`native pr device bytes: ${fixture.name}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.symlink("/dev/null", "/work/null-link");
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands());
  try {
    const result = await shell.exec(`pr ${fixture.args.map(argument => `'${argument}'`).join(" ")}`, { stdin: Buffer.from("616c7068610a626574610a", "hex") });
    assert.deepEqual({ status: result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, {
      status: 0, stdoutHex: fixture.stdoutHex, stderrHex: "",
    });
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["null-link"]);
    assert.equal(await fs.readlink("/work/null-link"), "/dev/null");
  } finally { await shell.dispose(); }
});

for (const name of ["/dev/null", "null-link"]) test(`null input ignores stdin and preserves backing shadow: ${name}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/dev");
  await fs.writeFile("/dev/null", Buffer.from("shadow must remain"));
  await fs.symlink("/dev/null", "/work/null-link");
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands());
  try {
    const result = await shell.exec(`pr -t ${name}`, { stdin: { [Symbol.asyncIterator]() { return {
      async next() { assert.fail("stdin must not be read for null input"); },
    }; } } });
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "", stderr: "" });
    assert.equal(Buffer.from(await fs.readFile("/dev/null")).toString(), "shadow must remain");
  } finally { await shell.dispose(); }
});

async function runDevice(fs: FileSystem, limits: Partial<PrLimits> = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await createPrCommand({ limits }).execute({
    command: "pr", args: ["-t", "device"], cwd: "/", env: { LC_ALL: "C", TZ: "UTC" }, fs,
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(value) { stdout.push(Uint8Array.from(value)); } },
    stderr: { async write(value) { stderr.push(Uint8Array.from(value)); } }, ...overrides,
  });
  return { ...result, stdout: Buffer.concat(stdout).toString("hex"), stderr: Buffer.concat(stderr).toString() };
}

async function characterFile(): Promise<FileSystem> {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/device", Uint8Array.of(255, 10, 65, 10));
  const stat = fs.stat.bind(fs);
  fs.stat = async (path, options) => ({ ...await stat(path, options), type: "character" });
  return fs;
}

for (const streaming of [true, false]) test(`nonempty VFS character input preserves raw bytes, streaming=${streaming}`, async () => {
  const fs = await characterFile();
  fs.capabilitiesFor = async () => ({ ...fs.capabilities, streamingRead: streaming });
  assert.deepEqual(await runDevice(fs, { maxInputBytes: 32 }), { exitCode: 0, stdout: "ff0a410a", stderr: "" });
});

for (const [limits, message] of [
  [{ maxInputBytes: 4 }, "input bytes"],
  [{ maxWork: 128 }, "work"],
  [{ maxBufferedBytes: 40 }, "buffered bytes"],
  [{ maxLineBytes: 2 }, "input line bytes"],
] as const) test(`character input retains ${message} bound and iterator cleanup`, async () => {
  const fs = await characterFile();
  let returned = 0, reads = 0;
  fs.readStream = () => ({ [Symbol.asyncIterator]() { return {
    async next() { reads++; return { done: false, value: Buffer.from("abcd\n".repeat(10)) }; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } });
  const result = await runDevice(fs, limits);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes(`${message} limit exceeded`), result.stderr);
  assert.ok(reads > 0 && reads < 10);
  assert.equal(returned, 1);
});

for (const reason of [false, 0, "", null]) test(`character acquisition cancellation retains cleanup and ${JSON.stringify(reason)}`, async () => {
  const fs = await characterFile();
  const caller = new AbortController();
  let returned = 0, reads = 0;
  fs.readStream = () => {
    caller.abort(reason);
    return { [Symbol.asyncIterator]() { return {
      async next() { reads++; return { done: true, value: undefined }; },
      async return() { returned++; return { done: true, value: undefined }; },
    }; } };
  };
  await assert.rejects(runDevice(fs, {}, { signal: caller.signal }), error => Object.is(error, reason));
  assert.deepEqual({ returned, reads }, { returned: 1, reads: 0 });
});

test("pr directory operands remain fatal rather than adopting tsort's directory quirk", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C", TZ: "UTC" } }).use(prCommands());
  try {
    const result = await shell.exec("pr -t .");
    assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { status: 1, stdout: "", stderr: "pr: .: Is a directory\n" });
  } finally { await shell.dispose(); }
});
