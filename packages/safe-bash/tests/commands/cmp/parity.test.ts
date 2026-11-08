import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { native, run } from "./helpers.js";

test("GNU 3.12 verbose exit status after an earlier complete differing block", {
  skip: process.env.CMP_ORACLE ? false : "GNU prerequisite unavailable: set CMP_ORACLE explicitly",
}, async () => {
  const left = Buffer.alloc(1048576, 97), right = Buffer.from(left);
  right[0] = 98;
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev/fd", { recursive: true });
  await fs.writeFile("/dev/fd/3", left);
  const args = ["-ln1048576", "/dev/fd/3", "-"];
  const expected = await native(args, left, right);
  const actual = await run(args, left, right, { fs });
  assert.equal(actual.stdout, expected.stdout);
  assert.equal(actual.stderr, expected.stderr);
  assert.equal(actual.exitCode, expected.exitCode);
});

test("GNU 3.12 physical EOF, counted EOF and tail differences with fragmented VFS inputs", {
  skip: process.env.CMP_ORACLE ? false : "GNU prerequisite unavailable: set CMP_ORACLE explicitly",
}, async () => {
  const cases = [
    { length: 1048576, differentAt: 0, count: undefined, extra: false },
    { length: 1048576, differentAt: 1048575, count: undefined, extra: false },
    { length: 1048576, differentAt: 1048575, count: 1048576, extra: false },
    { length: 1048577, differentAt: 0, count: undefined, extra: false },
    { length: 1048577, differentAt: 1048576, count: undefined, extra: false },
    { length: 1048577, differentAt: 1048576, count: 1048577, extra: false },
    { length: 1048576, differentAt: 0, count: undefined, extra: true },
  ];
  for (const scenario of cases) {
    const left = Buffer.alloc(scenario.length, 97), right = Buffer.alloc(scenario.length + Number(scenario.extra), 97);
    right[scenario.differentAt] = 98;
    const fs = createMemoryFileSystem();
    await fs.mkdir("/dev/fd", { recursive: true });
    await fs.writeFile("/dev/fd/3", left);
    const stat = fs.stat.bind(fs);
    fs.stat = async (path, options) => ({ ...await stat(path, options), size: -1 });
    const fragmented = (bytes: Uint8Array) => (async function* () {
      const fragment = Buffer.alloc(16385);
      let offset = 0, iteration = 0;
      try {
        while (offset < bytes.length) {
          const size = Math.min([7, 16385, 4093, 8192][iteration++ % 4]!, bytes.length - offset);
          fragment.set(bytes.subarray(offset, offset + size));
          yield fragment.subarray(0, size);
          offset += size;
        }
      } finally { fragment.fill(255); }
    })();
    fs.readStream = () => fragmented(left);
    const args = ["-l", ...(scenario.count === undefined ? [] : ["-n" + scenario.count]), "/dev/fd/3", "-"];
    const expected = await native(args, left, right);
    assert.deepEqual(await run(args, left, right, { fs, stdin: fragmented(right) }), expected, JSON.stringify(scenario));
  }
});
