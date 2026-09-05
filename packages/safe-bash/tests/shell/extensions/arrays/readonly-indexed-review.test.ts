import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { Shell } from "../../../../src/shell/shell.js";

interface Reference {
  readonly schemaVersion: number;
  readonly oracle: {
    readonly name: string;
    readonly executableSHA256: string;
    readonly environment: { readonly LC_ALL: string };
  };
  readonly records: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: readonly [string, string, string, string, string];
    readonly argv0: null;
    readonly inputHex: string;
    readonly expected: {
      readonly status: number;
      readonly signal: null;
      readonly stdoutHex: string;
      readonly stderrHex: string;
    };
  }[];
}

const referenceURL = new URL("./readonly-indexed-review-reference.json", import.meta.url);
const stat = lstatSync(referenceURL);
assert.ok(stat.isFile() && stat.size <= 128 * 1024, "Readonly indexed reference must be a bounded regular file");
const bytes = readFileSync(referenceURL);
assert.equal(createHash("sha256").update(bytes).digest("hex"), "f71eeae3dce837d844d7a4b82fffc61a5b953201f879487e6ce02ab20b3dd3b1");
const reference = JSON.parse(bytes.toString()) as Reference;
assert.equal(reference.schemaVersion, 1);
assert.equal(reference.oracle.name, "5.3.0");
assert.equal(reference.oracle.executableSHA256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.equal(reference.oracle.environment.LC_ALL, "C");
assert.equal(reference.records.length, 24);
assert.equal(new Set(reference.records.map(entry => entry.id)).size, 24);

for (const entry of reference.records) {
  assert.deepEqual(entry.args, ["--noprofile", "--norc", "-c", entry.args[3], "shell"]);
  assert.equal(entry.argv0, null);
  assert.equal(entry.expected.signal, null);
  assert.ok(Number.isInteger(entry.expected.status) && entry.expected.status >= 0 && entry.expected.status <= 255);
  for (const hex of [entry.inputHex, entry.expected.stdoutHex, entry.expected.stderrHex]) {
    assert.equal(Buffer.from(hex, "hex").toString("hex"), hex);
  }

  test("readonly indexed primary 5.3 " + entry.id + ": " + entry.name, async context => {
    const shell = new Shell({
      fs: createMemoryFileSystem(),
      extensions: [arraysExtension()],
      limits: { maxWallClockMs: 2000, maxOutputBytes: 65536, maxCommands: 128 },
    });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const actual = await shell.exec(entry.args[3], { stdin: Buffer.from(entry.inputHex, "hex"), env: { LC_ALL: "C" } });
    assert.deepEqual({
      status: actual.exitCode,
      stdout: Buffer.from(actual.stdoutBytes),
      stderr: Buffer.from(actual.stderrBytes),
    }, {
      status: entry.expected.status,
      stdout: Buffer.from(entry.expected.stdoutHex, "hex"),
      stderr: Buffer.from(entry.expected.stderrHex, "hex"),
    });
  });
}
