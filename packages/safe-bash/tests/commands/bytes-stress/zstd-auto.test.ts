import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "../../shell/helpers.js";
import { createByteCommands } from "../../../src/commands/bytes/index.js";
import { chunks, run } from "./helpers.js";

// Native-produced fixtures retained in issue 503; payload includes raw FE and NUL.
const payload = Buffer.from("Q2hhbmdlZEZvcmVpZ27+AAo=", "base64");
const frames = [
  "KLUv/QRQiQAAQ2hhbmdlZEZvcmVpZ27+AAoiCkV+",
  "H4sIAAAAAAAAA3POSMxLT01xyy9KzUzP+8fABQAFtYS1EQAAAA==",
  "/Td6WFoAAATm1rRGAgAhARIAAAAjuIcsAQAQQ2hhbmdlZEZvcmVpZ27+AAoAAAAA3x+RYrPGxpgAASkRMgpwDh+2830BAAAAAARZWg==",
  "XQAAIAD//////////wAhmggnELc2u24iCQvfb3WFMVF13Nn//+2NAAA=",
].map(value => Buffer.from(value, "base64"));
for (const alias of ["zstd", "unzstd", "zstdcat"]) {
  for (const width of [1, 7, 65536]) {
    for (const order of [[0], [1], [2], [3], [0, 1], [1, 0], [0, 2, 3, 1, 0]]) {
      test(`${alias} auto-decodes ${order} with chunks ${width}`, async () => {
        const encoded = Buffer.concat(order.map(index => frames[index]!));
        const result = await run(alias, ["-dc"], chunks(encoded, width));
        assert.equal(result.exitCode, 0, result.stderr.toString());
        assert.deepEqual(result.stdout, Buffer.concat(order.map(() => payload)));
        const named = await run(alias, ["-dc", "frame"], "", { files: { frame: encoded } });
        assert.equal(named.exitCode, 0, named.stderr.toString());
        assert.deepEqual(named.stdout, result.stdout);
        assert.deepEqual(Buffer.from(await named.fs.readFile("/work/frame")), encoded);
      });
    }
  }
}

test("skippable Zstd frame can precede foreign members", async () => {
  const skipped = Buffer.from([0x50, 0x2a, 0x4d, 0x18, 3, 0, 0, 0, 1, 2, 3]);
  const result = await run("zstd", ["-dc"], chunks(Buffer.concat([skipped, frames[1]!]), 1));
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, payload);
});

test("XZ padding preserves a following foreign member", async () => {
  const result = await run("zstd", ["-dc"], chunks(Buffer.concat([frames[2]!, Buffer.alloc(4), frames[1]!]), 1));
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.concat([payload, payload]));
});

for (const index of [1, 2, 3]) {
  test(`truncated foreign member ${index} fails even with force`, async () => {
    const result = await run("zstd", ["-dcf"], frames[index]!.subarray(0, frames[index]!.length - 4));
    assert.equal(result.exitCode, 1);
  });
}

test("gzip checksum failure preserves the decoded prefix and fails", async () => {
  const damaged = Buffer.from(frames[1]!);
  damaged[damaged.length - 8] = damaged[damaged.length - 8]! ^ 1;
  const result = await run("zstd", ["-dc"], Buffer.concat([frames[0]!, damaged]));
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stdout, Buffer.concat([payload, payload]));
});

for (const alias of ["zstd", "unzstd", "zstdcat"]) {
  for (const delivery of ["named", "pipe"]) {
    test(`Shell ${alias} ${delivery} restores mixed binary bytes and retains input`, async () => {
      const { shell, fs, commands } = setup();
      for (const command of createByteCommands()) commands.register(command);
      const encoded = Buffer.concat(frames);
      await fs.writeFile("/frame", encoded);
      try {
        const command = delivery === "named" ? `${alias} -dc /frame` : `pass < /frame | ${alias} -dc`;
        const result = await shell.exec(`${command} > /restored`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(Buffer.from(await fs.readFile("/restored")), Buffer.concat(frames.map(() => payload)));
        assert.deepEqual(Buffer.from(await fs.readFile("/frame")), encoded);
      } finally { await shell.dispose(); }
    });
  }
}
