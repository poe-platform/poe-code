import assert from "node:assert/strict";
import test from "node:test";
import { Shell, createMemoryFileSystem, standardCommands, spongeCommands } from "../../src/index.js";

for (const append of [false, true]) {
  for (const substitution of [false, true]) {
    test(`sponge preserves hard links and open descriptors (append=${append}, substitution=${substitution})`, async () => {
      const fs = createMemoryFileSystem();
      const shell = new Shell({ fs, cwd: "/" }).use(standardCommands()).use(spongeCommands());
      try {
        const command = `printf NEW | sponge ${append ? "-a " : ""}f`;
        const result = await shell.exec(`printf OLD > f; ln f alias; exec 3<f; ${substitution ? `saved=$(${command})` : command}; cat alias; cat <&3; cat f`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, append ? "OLDOLDOLDNEW" : "OLDOLDNEW");
      } finally {
        await shell.dispose();
      }
    });
  }
}
