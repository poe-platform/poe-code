import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import reference from "../../../../docs/csvkit/raw-operation-reference.json" with { type: "json" };
import parserReference from "../../../../docs/csvkit/oracle-3.14.2.json" with { type: "json" };
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("csvcut must not infer values"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

// Replay original observations through literal shell argv and compare bytes,
// including the BOM that the ShellResult display string intentionally decodes.
for (const [index, item] of reference.cases.entries()) {
  if (item.command !== "csvcut") continue;
  test(`csvcut user frozen exact-byte case ${index}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
    try {
      const command = ["csvcut", ...item.argv.map(arg => "'" + arg.replaceAll("'", "'\\''") + "'")].join(" ");
      const result = await shell.exec(command, { stdin: item.stdin });
      assert.equal(result.exitCode, item.status);
      assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(item.stdout));
      assert.deepEqual(result.stderrBytes, new TextEncoder().encode(item.stderr));
    } finally { await shell.dispose(); }
  });
}

test("csvcut user parser exits never read input and retain original executable identity", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const stdin = { [Symbol.asyncIterator]: () => ({
    next: async () => { throw new Error("parser exit must not read stdin"); },
    return: async () => ({ done: true as const, value: undefined })
  }) };
  try {
    for (const item of parserReference.filter(item => item.command === "csvcut")) {
      const result = await shell.exec(["csvcut", ...item.argv].join(" "), { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: item.stdout, stderr: item.stderr, status: item.status
      });
    }
    const unknown = parserReference.find(item => item.command === "csvcut" && item.status === 2)!;
    const usage = unknown.stderr.slice(0, unknown.stderr.indexOf("csvcut: error:"));
    for (const flag of ["-s", "--snifflimit", "-I", "--no-inference", "-L", "--locale", "--blanks", "--null-value"]) {
      const result = await shell.exec(`csvcut ${flag}`, { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: "", stderr: `${usage}csvcut: error: unrecognized arguments: ${flag}\n`, status: 2
      });
    }
  } finally { await shell.dispose(); }
});

test("csvcut user pending stdin cancellation cooperatively closes once and preserves falsey reason", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  const controller = new AbortController();
  let admitted!: () => void;
  const started = new Promise<void>(resolve => { admitted = resolve; });
  let release!: () => void;
  const pending = new Promise<IteratorResult<Uint8Array>>(resolve => {
    release = () => resolve({ done: true, value: undefined });
  });
  let closed = 0;
  const execution = shell.exec("csvcut -c 1", {
    signal: controller.signal,
    stdin: { [Symbol.asyncIterator]: () => ({
      next: () => { admitted(); return pending; },
      return: async () => { closed++; release(); return { done: true, value: undefined }; }
    }) }
  });
  const rejected = assert.rejects(execution, reason => reason === false);
  try {
    await started;
    controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(closed, 1, "registered cleanup must release pending stdin without a rescue");
    await rejected;
  } finally {
    release();
    await rejected;
    await shell.dispose();
  }
  assert.equal(closed, 1);
});
