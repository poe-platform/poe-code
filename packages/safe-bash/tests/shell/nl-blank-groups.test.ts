import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";
import { nlCommands } from "../../src/commands/nl/index.js";

for (const group of ["0", "1", "2", "9007199254740992", "9223372036854775807", "9223372036854775808", "18446744073709551616", "-1"]) {
  for (const option of [`-l ${group}`, `-l${group}`, `--join-blank-lines=${group}`]) {
    test(`nl blank grouping in command substitution: ${option}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use({ name: "basic", setup(host) {
        for (const command of [...basicCommands(), ...streamCommands()]) host.commands.register(command);
      } }).use(nlCommands());
      try {
        const command = `printf '\\n\\nX\\n' | nl -ba -w1 -s'|' ${option}`;
        const expected = group === "-1" ? "" : group === "0" || group === "1" ? "1|\n2|\n3|X\n"
          : group === "2" ? "  \n1|\n2|X\n" : "  \n  \n1|X\n";
        const direct = await shell.exec(command);
        assert.equal(direct.exitCode, group === "-1" ? 1 : 0, direct.stderr);
        assert.equal(direct.stdout, expected);
        const substituted = await shell.exec(`result=$(${command}); status=$?; printf '%s' "$result"; exit "$status"`);
        assert.equal(substituted.exitCode, direct.exitCode, substituted.stderr);
        assert.equal(substituted.stdout, expected.slice(0, -1));
        assert.equal(substituted.stderr, direct.stderr);
      } finally { await shell.dispose(); }
    });
  }
}
