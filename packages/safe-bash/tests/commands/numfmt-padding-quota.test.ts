import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../src/contracts/index.js";
import { numfmtCommand } from "../../src/commands/numfmt.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

for (const padding of [16000000, -16000000]) {
  test(`numfmt streams padding ${padding} under a small shell quota`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([numfmtCommand()]), limits: { maxOutputBytes: 1024 } });
    const allocations: number[] = [];
    const start = String.prototype.padStart;
    const end = String.prototype.padEnd;
    const repeat = String.prototype.repeat;
    String.prototype.padStart = function(length, fill) { allocations.push(length); return start.call(this, length, fill); };
    String.prototype.padEnd = function(length, fill) { allocations.push(length); return end.call(this, length, fill); };
    String.prototype.repeat = function(count) { allocations.push(String(this).length * count); return repeat.call(this, count); };
    try {
      await assert.rejects(shell.exec(`numfmt --padding=${padding} 1`), { name: "ShellLimitError", limit: "maxOutputBytes" });
      assert.ok(allocations.every(length => length <= 65536), `oversized padding allocation: ${allocations}`);
    } finally {
      String.prototype.padStart = start;
      String.prototype.padEnd = end;
      String.prototype.repeat = repeat;
      await shell.dispose();
    }
  });
}

for (const padding of [2050, -2050]) {
  test(`numfmt preserves chunked padding ${padding} and format affixes`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([numfmtCommand()]), env: { LC_ALL: "C" }, limits: { maxOutputBytes: 2055 } });
    try {
      const result = await shell.exec(`numfmt --format='[%${padding}f]' 1`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `[${padding < 0 ? "1" + " ".repeat(2049) : " ".repeat(2049) + "1"}]\n`);
    } finally { await shell.dispose(); }
  });
}
