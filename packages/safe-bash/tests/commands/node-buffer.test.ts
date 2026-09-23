import assert from "node:assert/strict";
import test from "node:test";
import { Budget, declareHostOperation, makeFsModule, run } from "../../../safe-js/src/index.js";
import { nodeCommands } from "../../src/commands/node/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const runtime = { run, makeFsModule, declareHostOperation, createBudget: (options: ConstructorParameters<typeof Budget>[0]) => new Budget(options) };

function quote(source: string): string {
  return "'" + source.replaceAll("'", "'\\''") + "'";
}

test("node provides Buffer string and byte conversions through the real SafeJS runtime", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime }));
  try {
    for (const [source, expected] of [
      ['console.log(Buffer.from("abc").toString("hex"))', "616263\n"],
      ['console.log(Buffer.from("hé😀").toString("base64"))', "aMOp8J+YgA==\n"],
      ['console.log(Buffer.from("aMOp8J-YgA", "base64url").toString())', "hé😀\n"],
      ['console.log(Buffer.from([0, 255, 256, -1]).toString("hex"))', "00ff00ff\n"],
      ['console.log(Buffer.from("61zz62", "hex").toString())', "a\n"],
      ['console.log(Buffer.byteLength("hé😀"), Buffer.isEncoding("UTF-8"), Buffer.isEncoding("bad"))', "7 true false\n"],
      ['const b = Buffer.from("abc"); console.log(b instanceof Uint8Array, Buffer.isBuffer(b), Buffer.isBuffer(new Uint8Array(1))); b[0] = 100; console.log(b.toString());', "true true false\ndbc\n"],
      ['const b = Buffer.from("abc"); const view = b.slice(1); view[0] = 100; console.log(b.toString(), view.toString(), Buffer.isBuffer(view));', "adc dc true\n"],
      ['const a = new Uint8Array([97, 98]); const copy = Buffer.from(a); const view = Buffer.from(a.buffer, 1, 1); a[1] = 99; console.log(copy.toString(), view.toString());', "ab c\n"],
      ['console.log(Buffer.alloc(3, "ab").toString(), Buffer.concat([Buffer.from("a"), Buffer.from("b")], 3).toString("hex"))', "aba 616200\n"],
      ['console.log(Buffer.alloc(3, "").toString("hex"), Buffer.from("abc").toString("utf8", -1, 2), Buffer.from("abc").equals(Buffer.from("abc")))', "000000 ab true\n"],
    ]) {
      const result = await shell.exec("node -e " + quote(source!));
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected, source);
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

test("node bounds Buffer allocations and rejects invalid inputs without native capabilities", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(nodeCommands({ runtime, limits: { arrayLength: 64, stringLength: 2048 } }));
  try {
    for (const source of ['Buffer.alloc(65)', 'Buffer.from("a".repeat(65))', 'Buffer.alloc(64).toString("hex").repeat(17)']) {
      assert.equal((await shell.exec("node -e " + quote(source))).exitCode, 124, source);
    }
    for (const source of ['Buffer.from(3)', 'Buffer.from("a", "bad")', 'Buffer.alloc(-1)', 'Buffer.alloc("3")', 'Buffer.concat([], 1.5)', 'Buffer.from("abc").constructor.constructor("return process")().binding("fs")']) {
      assert.equal((await shell.exec("node -e " + quote(source))).exitCode, 1, source);
    }
    assert.equal((await shell.exec("node -p 'Buffer.from(\"abc\").toString()'")).stdout, "abc\n");
  } finally { await shell.dispose(); }
});
