import assert from "node:assert/strict";
import test from "node:test";
import "../../src/shell/sync-extra-evaluators.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { commCommands } from "../../src/commands/comm/index.js";

for (const [environment, posix] of [
  ["unset POSIXLY_CORRECT", false],
  ["export POSIXLY_CORRECT=1", true],
  ["export POSIXLY_CORRECT=", true],
  ["unset POSIXLY_CORRECT; POSIXLY_CORRECT=1", false],
] as const) {
  for (const [source, posixOutput, defaultOutput] of [
    ["comm one -1", "a\n\tx\n", undefined],
    ["comm one two -1", undefined, "x\n"],
    ["comm -- one -1", "a\n\tx\n", "a\n\tx\n"],
    ["comm -1 one two", "x\n", "x\n"],
    ["comm --output-delimiter : one -1", "a\n:x\n", undefined],
    ["comm one -1 | cat", "a\n\tx\n", undefined],
    ["comm one two -1 | cat", undefined, "x\n"],
    ["printf 'a\\n' | comm - -1", "a\n\tx\n", undefined],
    ["comm - -1 <<< a", "a\n\tx\n", undefined],
    ["comm - -1 < one", "a\n\tx\n", undefined],
  ] as const) {
    test(`comm operand ordering: ${environment}; ${source}`, async context => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs }).use(standardCommands()).use(commCommands());
      context.after(() => shell.dispose());
      for (const [path, content] of [["/one", "a\n"], ["/two", "x\n"], ["/-1", "x\n"]] as const) {
        await fs.writeFile(path, new TextEncoder().encode(content));
      }
      const expected = posix ? posixOutput : defaultOutput;
      for (const body of [
        source,
        `x=$(${source}); status=$?; printf %s "$x"; exit "$status"`,
        `for ((i=0;i<2;i++)); do x=$(${source}); status=$?; done; printf %s "$x"; exit "$status"`,
      ]) {
        const result = await shell.exec(`${environment}; set -o pipefail; ${body}`);
        assert.equal(result.exitCode, expected === undefined ? 1 : 0, body);
        assert.equal(result.stdout, body === source ? expected ?? "" : (expected ?? "").trimEnd(), body);
        assert.equal(result.stderr, expected === undefined ? "comm: EINVAL: comm requires exactly two files\n".repeat(body.startsWith("for") ? 2 : 1) : "", body);
      }
    });
  }
}
