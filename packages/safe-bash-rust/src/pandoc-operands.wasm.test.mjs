import assert from "node:assert/strict";
import test from "node:test";
import { createRustWasmBash } from "./index.js";

for (const flag of ["", "--file-scope"]) {
  test(`Pandoc preserves operand boundaries ${flag}`, async () => {
    const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
    try {
      for (const [a, b, expected] of [
        ["a", "b", "a\n\nb\n"], ["a\n", "b\n", "a\n\nb\n"],
        ["a\r\n", "b\r\n", "a\n\nb\n"], ["", "b", "b\n"],
        ["a", "", "a\n"], ["# A", "# B", "A\n\nB\n"],
      ]) {
        await bash.fs.writeFile("/a.md", a); await bash.fs.writeFile("/b.md", b);
        const result = await bash.exec(`pandoc -f markdown -t plain /a.md /b.md ${flag}`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, expected);
      }
      await bash.fs.writeFile("/a.md", "- a"); await bash.fs.writeFile("/b.md", "- b");
      const lists = await bash.exec(`pandoc -f markdown -t json /a.md /b.md ${flag}`);
      assert.equal(lists.exitCode, 0, lists.stderr);
      assert.equal(JSON.parse(lists.stdout).blocks.filter(block => block.t === "BulletList").length, flag ? 2 : 1);
      await bash.fs.writeFile("/a.md", "a"); await bash.fs.writeFile("/b.md", "b");
      for (const [operands, expected] of [
        ["/a.md - /b.md", "a\n\ns\n\nb\n"], ["- /a.md", "s\n\na\n"], ["/a.md", "a\n"],
      ]) {
        const result = await bash.exec(`pandoc -f markdown -t plain ${operands} ${flag}`, {stdin: "s"});
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, expected);
      }
      await bash.fs.writeFile("/out.txt", "KEEP");
      const failed = await bash.exec(`pandoc -f markdown -t plain /a.md /missing.md -o /out.txt ${flag}`);
      assert.notEqual(failed.exitCode, 0);
      assert.deepEqual(await bash.fs.readFile("/out.txt"), new TextEncoder().encode("KEEP"));
    } finally { await bash.dispose(); }
  });
}
