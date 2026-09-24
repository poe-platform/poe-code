import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";

test("UTF-16 byte order is independent for every input file", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/be", Uint8Array.of(0xfe, 0xff, 0, 65));
  await fs.writeFile("/le", Uint8Array.of(0xff, 0xfe, 66, 0));
  await fs.writeFile("/plain", Uint8Array.of(67, 0));
  const result = await run(["-f", "UTF-16", "-t", "UTF-8", "/be", "/le", "/be", "/plain"], undefined, {}, { fs });
  assert.deepEqual(result, { exitCode: 0, stdoutHex: "41424143", stderrHex: "" });
});

for (const [target, expected] of [["ASCII//IGNORE", "6361660a"], ["ASCII//TRANSLIT//IGNORE", "6361663f0a"], ["ASCII//IGNORE//TRANSLIT", "6361663f0a"], ["UTF-8//IGNORE", "636166c3a90a"]]) {
  test(`target suffix ${target}`, async () => {
    assert.deepEqual(await run(["-f", "UTF-8", "--to-code", target!], Buffer.from("caf\u00e9\n")), { exitCode: 0, stdoutHex: expected, stderrHex: "" });
  });
}

for (const hex of ["f4908080", "f7bfbfbf", "f888808080", "fbbfbfbfbf", "fc8480808080", "fdbfbfbfbfbf"]) {
  test(`invalid Unicode UTF-8 ${hex} is rejected or discarded`, async () => {
    const input = Buffer.from(`41${hex}42`, "hex");
    const rejected = await run(["-f", "UTF-8", "-t", "UTF-8"], input);
    assert.equal(rejected.exitCode, 1);
    assert.equal(rejected.stdoutHex, "41");
    assert.match(Buffer.from(rejected.stderrHex, "hex").toString(), /illegal input sequence/);
    for (const flags of [["-c", "-t", "UTF-8"], ["-t", "UTF-8//IGNORE"]]) {
      const discarded = await run(["-f", "UTF-8", ...flags], input);
      assert.equal(discarded.stdoutHex, "4142");
      assert.equal(discarded.stderrHex, "");
    }
  });
}

test("maximum Unicode scalar remains valid", async () => {
  assert.deepEqual(await run(["-f", "UTF-8", "-t", "UTF-8"], Buffer.from("f48fbfbf", "hex")), { exitCode: 0, stdoutHex: "f48fbfbf", stderrHex: "" });
});
