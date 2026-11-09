import assert from "node:assert/strict";
import test from "node:test";
import "../../src/shell/sync-extra-evaluators.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { tsortCommands } from "../../src/commands/tsort/index.js";

for (const [environment, posix] of [
  ["unset POSIXLY_CORRECT", false],
  ["export POSIXLY_CORRECT=1", true],
  ["export POSIXLY_CORRECT=", true],
  ["unset POSIXLY_CORRECT; POSIXLY_CORRECT=1", false],
] as const) {
  for (const invocation of [
    "tsort f --",
    "tsort -- f",
    "tsort f -- | cat",
    "printf 'a b\\n' | tsort - --",
    "tsort - -- < f",
    "tsort - -- <<< 'a b'",
  ]) {
    test(`tsort operand ordering: ${environment}; ${invocation}`, async context => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/f", new TextEncoder().encode("a b\n"));
      const shell = new Shell({ fs }).use(standardCommands()).use(tsortCommands());
      context.after(() => shell.dispose());
      const fails = posix && invocation !== "tsort -- f";
      for (const body of [
        invocation,
        `result=$(${invocation}); rc=$?; printf '%s' "$result"; exit "$rc"`,
        `for ((i=0;i<2;i++)); do result=$(${invocation}); rc=$?; done; printf '%s' "$result"; exit "$rc"`,
      ]) {
        const result = await shell.exec(`export LC_ALL=C; ${environment}; set -o pipefail; ${body}`);
        assert.equal(result.exitCode, fails ? 1 : 0, body);
        assert.equal(result.stdout, fails ? "" : body === invocation ? "a\nb\n" : "a\nb", body);
        assert.equal(result.stderr, fails ? "tsort: extra operand '--'\nTry 'tsort --help' for more information.\n".repeat(body.startsWith("for") ? 2 : 1) : "", body);
      }
    });
  }
}
