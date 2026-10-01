import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem, OverlayFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../../src/shell/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";

test("sed and awk execute without a global Buffer", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("héllo world\n"));
  const shell = new Shell({ fs }).use(textProgramCommands());
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  try {
    Reflect.deleteProperty(globalThis, "Buffer");
    for (const [command, stdin, stdout] of [
      ["sed 's/hello/world/'", "hello\n", "world\n"],
      ["awk '{print $2, $1}'", "hello world\n", "world hello\n"],
      ["sed 'h;s/world/earth/;G' /input", "", "héllo earth\nhéllo world\n"],
      ["awk '{print $2, $1}' /input", "", "world héllo\n"],
      ["sed -i.bak 's/world/earth/' /input", "", ""],
    ] as const) {
      const result = await shell.exec(command, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, stdout);
    }
    assert.equal(new TextDecoder().decode(await fs.readFile("/input")), "héllo earth\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/input.bak")), "héllo world\n");
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
    await shell.dispose();
  }
});

for (const suffix of ["", ".bak"]) {
  for (const existingBackup of [false, true]) {
    test(`sed -i${suffix} edits overlay root files with existing backup ${existingBackup}`, async () => {
      const lower = new MemoryFileSystem();
      await lower.writeFile("/a.txt", new TextEncoder().encode("hello\n"), { mode: 0o640 });
      if (existingBackup) await lower.writeFile("/a.txt.bak", new TextEncoder().encode("old backup\n"), { mode: 0o600 });
      const fs = new OverlayFileSystem({ lower, upper: new MemoryFileSystem() });
      const shell = new Shell({ fs }).use(textProgramCommands());
      try {
        const result = await shell.exec(`sed -i${suffix} 's/hello/HELLO/' /a.txt`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(new TextDecoder().decode(await fs.readFile("/a.txt")), "HELLO\n");
        assert.equal(new TextDecoder().decode(await lower.readFile("/a.txt")), "hello\n");
        if (suffix) {
          assert.equal(new TextDecoder().decode(await fs.readFile("/a.txt.bak")), "hello\n");
          assert.equal((await fs.stat("/a.txt.bak")).mode & 0o777, 0o640);
        }
        assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), suffix || existingBackup ? ["a.txt", "a.txt.bak"] : ["a.txt"]);
      } finally { await shell.dispose(); }
    });
  }
}
