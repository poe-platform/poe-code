import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { structuredCommands } from "../../src/commands/structured/index.js";
import { searchCommands } from "../../src/commands/search/index.js";

import { grepCommands } from "../../src/commands/grep/index.js";

const cases = [
  ['sed "s/hello/HI/" /big.txt', "hello world\n".repeat(30)],
  ['sed "s/^hello/HI/;s/world/WORLD/" /big.txt', "hello world\n".repeat(30)],
  ['grep hello /big.txt', "hello world\n".repeat(30)],
  ['grep -c hello /big.txt', "hello world\n".repeat(30)],
  ['rg hello /big.txt', "hello world\n".repeat(30)],
  ['rg -c hello /big.txt', "hello world\n".repeat(30)],
  ['rg -c hello /', "hello world\n".repeat(30)],
  ['rg -l hello /', "hello world\n".repeat(30)],
  ['rg -l hello /big.txt', "hello world\n".repeat(30)],
  ['sed "s/hello/HI/" /big.txt', "hello wörld\n".repeat(30)],
  ['jq . /big.txt', '{"x":1}\n'.repeat(50)],
  ['jq -c . /big.txt', '{"x":1}\n'.repeat(50)],
  ['jq -c "select(.x == 1)" /big.txt', '{"x":1}\n'.repeat(50)],
  ['awk "{print}" /big.txt', "hello world\n".repeat(30)],
  ["awk -F: '{print $1}' /big.txt", "hello:world\n".repeat(30)],
] as const;

for (const [command, input] of cases) {
  test(`memory file input budget: ${command}`, async () => {
    const fs = createMemoryFileSystem();
    const bytes = new TextEncoder().encode(input);
    await fs.writeFile("/big.txt", bytes);
    const baseline = await new Shell({ fs }).use(grepCommands())
      .use(textProgramCommands()).use(structuredCommands()).use(searchCommands()).exec(command);
    assert.equal(baseline.exitCode, 0, baseline.stderr);
    assert.notEqual(baseline.stdout, "");
    for (const maxInputBytes of [4, bytes.length - 1, bytes.length, bytes.length + 1, Infinity]) {
      const shell = new Shell({ fs, limits: { maxInputBytes } })
        .use(grepCommands()).use(textProgramCommands()).use(structuredCommands()).use(searchCommands());
      for (let attempt = 0; attempt < 2; attempt++) {
        if (maxInputBytes < bytes.length) {
          await assert.rejects(shell.exec(command),
            (error) => error instanceof ShellLimitError && error.limit === "maxInputBytes");
        } else {
          const result = await shell.exec(command);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stdout, baseline.stdout);
        }
      }
    }
  });
}
