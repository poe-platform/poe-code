import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec, pythonCodecs, createGzipCompressionProvider } from "safe-bash-command-csvkit";
import { createCompressionCodec } from "@poe-code/office-package/compression";
import reference from "../../../../docs/csvkit/in2csv-fixed-reference.json" with { type: "json" };
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, createCsvkitCommands } from "../../src/commands/csvkit/index.js";

const options = {
  codecs: [utf8Codec, ...pythonCodecs],
  compression: [createGzipCompressionProvider(createCompressionCodec())],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unmeasured locale formatting"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

// Independent released reference bytes; public shell invocation must preserve them.
for (const [index, item] of reference.cases.entries()) test(`in2csv fixed user reference ${index}: ${item.argv.join(" ")}`, async () => {
  const fs = new MemoryFileSystem();
  const files = new Map<string, Uint8Array>();
  for (const [path, contents] of Object.entries(item.files)) files.set("/" + path, new TextEncoder().encode(contents));
  if ("binaries" in item) for (const [path, contents] of Object.entries(item.binaries!)) files.set("/" + path, Uint8Array.from(Buffer.from(contents, "base64")));
  for (const [path, contents] of files) await fs.writeFile(path, contents);
  const shell = new Shell({ fs, env: { PYTHONIOENCODING: "utf-8" } }).use(csvkitCommands(options));
  try {
    const command = "in2csv " + item.argv.map(arg => "'" + arg.replaceAll("'", "'\\''") + "'").join(" ");
    const result = await shell.exec(command, { stdin: "stdinBase64" in item ? Buffer.from(item.stdinBase64!, "base64") : item.stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: item.stdout, stderr: item.stderr, status: item.status });
    for (const [path, contents] of files) assert.deepEqual(await fs.readFile(path), contents);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), [...files.keys()].map(path => path.slice(1)).sort());
  } finally { await shell.dispose(); }
});

test("in2csv fixed user closing header output releases schema without acquiring borrowed data", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/schema.csv", new TextEncoder().encode("column,start,length\na,0,1\n"));
  const command = createCsvkitCommands(options).find(item => item.name === "in2csv")!;
  const consumer = new AbortController(); const caller = new AbortController();
  const reason = new Error("fixed header consumer closed");
  const cleanups: (() => void | Promise<void>)[] = [];
  const writes: string[] = [];
  const write = async (bytes: Uint8Array) => { writes.push(new TextDecoder().decode(bytes)); consumer.abort(reason); };
  await assert.rejects(Promise.resolve(command.execute({
    command: "in2csv", args: ["-f", "fixed", "-s", "/schema.csv"], cwd: "/", env: {}, fs, signal: caller.signal,
    stdin: { [Symbol.asyncIterator]() { assert.fail("header cancellation must not acquire borrowed input"); } },
    stdout: { write, ownedOutput: { write, consumerClosed: consumer.signal } },
    stderr: { async write() { assert.fail("consumer closure must not print a diagnostic"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  })), caught => caught === reason);
  await Promise.all(cleanups.map(cleanup => cleanup()));
  assert.deepEqual(writes, ["a\n"]);
  assert.equal(caller.signal.aborted, false);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["schema.csv"]);
});

test("in2csv fixed user owns bytes when borrowed producer reuses its buffer", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/schema.csv", new TextEncoder().encode("column,start,length\na,0,1\n"));
  const command = createCsvkitCommands(options).find(item => item.name === "in2csv")!;
  const bytes = new TextEncoder().encode("x\n".repeat(4096));
  let index = 0; let returns = 0;
  const writes: string[] = []; const cleanups: (() => void | Promise<void>)[] = [];
  const result = await command.execute({
    command: "in2csv", args: ["-f", "fixed", "-s", "/schema.csv"], cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { return {
      async next() {
        if (index++ === 0) return { done: false as const, value: bytes };
        bytes.fill(121);
        return { done: true as const, value: undefined };
      },
      async return() { returns++; return { done: true as const, value: undefined }; }
    }; } },
    stdout: { async write(bytes) { writes.push(new TextDecoder().decode(bytes)); } },
    stderr: { async write() { assert.fail("valid fixed input must not print diagnostics"); } },
    registerCleanup: cleanup => { cleanups.push(cleanup); }
  });
  await Promise.all(cleanups.map(cleanup => cleanup()));
  assert.equal(result.exitCode, 0);
  assert.equal(writes.join(""), "a\n" + "x\n".repeat(4096));
  assert.equal(returns, 1);
});
