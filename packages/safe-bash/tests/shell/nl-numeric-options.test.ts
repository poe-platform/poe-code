import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";
import { nlCommands } from "../../src/commands/nl/index.js";

for (const option of ["-w", "-l", "-v", "-i"]) {
  for (const value of ["1", "+1", "-1", " 1", "\t+1", "1 ", "1\t"]) {
    test(`nl quoted numeric variable ${option} ${JSON.stringify(value)} in substitution`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem() }).use({ name: "basic", setup(host) {
        for (const command of [...basicCommands(), ...streamCommands()]) host.commands.register(command);
      } }).use(nlCommands());
      try {
        const valid = !value.endsWith(" ") && !value.endsWith("\t")
          && (value !== "-1" || option === "-v" || option === "-i");
        const expected = !valid ? "" : value !== "-1" ? "1\tA\n2\tB\n"
          : option === "-v" ? "-1\tA\n0\tB\n" : "1\tA\n0\tB\n";
        const prefix = `n='${value}'; `;
        const command = `printf 'A\\nB\\n' | nl -w1 ${option} "$n"`;
        const direct = await shell.exec(prefix + command);
        assert.equal(direct.exitCode, valid ? 0 : 1);
        assert.equal(direct.stdout, expected);
        const substituted = await shell.exec(`${prefix} result=$(${command}); status=$?; printf '%s' "$result"; exit "$status"`);
        assert.deepEqual(substituted, {
          ...direct,
          stdout: expected.slice(0, -1),
          stdoutBytes: new TextEncoder().encode(expected.slice(0, -1)),
        });
      } finally { await shell.dispose(); }
    });
  }
}
