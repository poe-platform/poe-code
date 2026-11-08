import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import reference from "../../../../docs/csvkit/nonworkbook-user-review-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};
const encoder = new TextEncoder();
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

for (const [index, observation] of reference.cases.entries()) {
  test(`csvkit independent user review ${index}: ${observation.argv.join(" ")}`, async () => {
    const fs = new MemoryFileSystem();
    const original = encoder.encode(observation.input);
    await fs.writeFile("/input.csv", original);
    const shell = new Shell({ fs }).use(csvkitCommands(options));
    try {
      // Reuse one buffer across reads and split both Unicode codepoints and CRLF.
      const fragmented = { async *[Symbol.asyncIterator]() {
        const buffer = new Uint8Array(3);
        for (let offset = 0; offset < original.length; offset += buffer.length) {
          const size = Math.min(buffer.length, original.length - offset);
          buffer.set(original.subarray(offset, offset + size));
          yield buffer.subarray(0, size);
          yield new Uint8Array();
        }
        buffer.fill(0xff);
      } };
      const command = observation.argv.map(quote).join(" ");
      const result = await shell.exec(command, { stdin: fragmented });
      assert.equal(result.exitCode, observation.expected.status);
      assert.deepEqual(result.stdoutBytes, encoder.encode(observation.expected.stdout));
      assert.deepEqual(result.stderrBytes, encoder.encode(observation.expected.stderr));
      const redirected = await shell.exec(`${command} < /input.csv > /output.csv`);
      assert.equal(redirected.exitCode, observation.expected.status);
      assert.deepEqual(redirected.stdoutBytes, new Uint8Array());
      assert.deepEqual(redirected.stderrBytes, encoder.encode(observation.expected.stderr));
      assert.deepEqual(await fs.readFile("/output.csv"), encoder.encode(observation.expected.stdout));
      assert.deepEqual(await fs.readFile("/input.csv"), original);
      assert.deepEqual((await fs.readdir("/")).sort((a, b) => a.name.localeCompare(b.name)), [
        { name: "input.csv", type: "file" }, { name: "output.csv", type: "file" }
      ]);
    } finally { await shell.dispose(); }
  });
}
