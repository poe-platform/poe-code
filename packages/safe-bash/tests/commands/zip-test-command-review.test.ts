import assert from "node:assert/strict";
import test from "node:test";
import { parseZipTestCommand } from "../../src/commands/archive/zip/test-command.js";
import { archiveBytes, execute, fixture } from "./zip-standard-flags.helpers.js";

for (const [command, expected] of [
  ["verify '' \"\" 'two words' escaped\\ word", ["verify", "", "", "two words", "escaped word"]],
  ["\tverify\t--check\t{}\t", ["verify", "--check", "{}"]],
  ["verify '{}/{}' prefix{}suffix", ["verify", "{}/{}", "prefix{}suffix"]],
] as const) test(`virtual ZIP test argv preserves literal arguments: ${command}`, () => {
  assert.deepEqual(parseZipTestCommand(command), expected);
});

for (const command of ["", "'' arg", "{} arg", "verify \\", "verify \"unterminated", "verify\0x", "verify\nx", "verify `x`", "verify >output", "verify && other", "verify '$HOME'"]) {
  test(`virtual ZIP test argv rejects unsupported syntax: ${JSON.stringify(command)}`, () => {
    assert.throws(() => parseZipTestCommand(command), error => error instanceof Error && "status" in error && error.status === 16);
  });
}

test("virtual ZIP test expands each placeholder and preserves empty arguments without appending a second path", async () => {
  const fs = await fixture(await archiveBytes([{ name: "a", body: Buffer.from("old") }]));
  await fs.writeFile("/work/b", Buffer.from("new"));
  let called = false;
  const result = await execute("zip", fs, ["-T", "-TT", "verify '' '{}/{}' prefix{}suffix", "sample.zip", "b"], {}, {
    async invoke(command, args) {
      called = true;
      assert.equal(command, "verify");
      assert.deepEqual(args, ["", "/work/.zip-1/archive.zip//work/.zip-1/archive.zip", "prefix/work/.zip-1/archive.zipsuffix"]);
      return { exitCode: 0 };
    },
  });
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  assert.equal(called, true);
});

for (const short of [false, true]) test(`virtual ZIP test combines stdout and stderr output limits: short=${short}`, async () => {
  const fs = await fixture(await archiveBytes([{ name: "a", body: Buffer.from("old") }]));
  await fs.writeFile("/work/b", Buffer.from("new"));
  const before = await fs.readFile("/work/sample.zip");
  const result = await execute("zip", fs, ["-qT", "-TT", "verify", "sample.zip", "b"], { limits: { maxTextBytes: 128 - Number(short) } }, {
    async invoke(_command, _args, context) {
      await context!.stdout!.write(new Uint8Array(64));
      await context!.stderr!.write(new Uint8Array(64));
      return { exitCode: 0 };
    },
  });
  assert.equal(result.exitCode, short ? 8 : 0, result.stderr + result.stdout);
  if (short) assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal((await fs.readdir("/work")).some(entry => entry.name.startsWith(".zip-")), false);
});
