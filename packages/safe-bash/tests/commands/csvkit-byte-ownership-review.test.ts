import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";

const bindings = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

for (const [command, input, output] of [
  ["csvcut /owned.csv", "a,b\n😀,é\n", "a,b\n😀,é\n"],
  ["csvjson -I -y 0 /owned.csv", "a,b\n😀,é\n", '[{"a": "😀", "b": "é"}]'],
  ["in2csv -f json /owned.csv", '[{"a":"😀","b":"é"}]', "a,b\n😀,é\n"]
] as const) test(`${command} owns retained bytes from reused Buffer views through producer finalization`, async () => {
  const fs = new MemoryFileSystem();
  const original = new TextEncoder().encode(input);
  const storage = Buffer.alloc(3, 0xa5);
  const view = storage.subarray(1, 2);
  let finalized = 0;
  Object.assign(fs, {
    async readFile() { assert.fail("named streaming input must not bulk-read"); },
    readStream(path: string) {
      assert.equal(path, "/owned.csv");
      return { async *[Symbol.asyncIterator]() {
        try {
          for (const byte of original) { view[0] = byte; yield view; }
        } finally { storage.fill(0); finalized++; }
      } };
    }
  });
  const shell = new Shell({ fs }).use(csvkitCommands(bindings));
  try {
    const result = await shell.exec(command, {
      stdin: { async *[Symbol.asyncIterator]() { assert.fail("named input must not acquire stdin"); yield new Uint8Array(); } }
    });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, { stdout: output, stderr: "", status: 0 });
    assert.equal(finalized, 1);
    assert.deepEqual(storage, Buffer.alloc(3));
  } finally { await shell.dispose(); }
  assert.equal(finalized, 1);
});
