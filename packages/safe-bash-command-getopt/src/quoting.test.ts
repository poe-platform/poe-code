import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { getoptCommands } from "./index.js";

// Runtime source loading keeps the Shell outside this package's typecheck.
const safeBashSource: string = "../../safe-bash/src/index.js";

const cases = [
  ["", "''"],
  ["a b", "'a'\\ 'b'"],
  ["a!b", "'a'\\!'b'"],
  ["a'b", "'a'\\''b'"],
  ["a\\b", "'a\\\\b'"],
  ["a\nb", "'a\\nb'"],
  ["a\tb", "'a'\\\t'b'"],
  ["a\vb", "'a'\\\v'b'"],
  ["a\fb", "'a'\\\f'b'"],
  ["a\rb", "'a'\\\r'b'"],
] as const;

for (const mode of ["csh", "tcsh", "bash", "sh"]) {
  test(`getopt ${mode} direct and captured output match util-linux quoting`, async () => {
    const { Shell, standardCommands } = await import(safeBashSource);
    const shell = new Shell({ fs: createMemoryFileSystem() })
      .use(standardCommands()).use(getoptCommands());
    try {
      for (const [value, cshQuoted] of cases) {
        const literal = "'" + value.replaceAll("'", "'\\''") + "'";
        const quoted = mode === "csh" || mode === "tcsh" ? cshQuoted : literal;
        for (const options of ["-o '' --", "-o a: -- -a", "-o '' -l arg: -- --arg"]) {
          const prefix = options === "-o '' --" ? " -- " : options === "-o a: -- -a" ? " -a " : " --arg ";
          const expected = prefix + quoted + (options === "-o '' --" ? "" : " --");
          const command = `getopt -s ${mode} ${options} ${literal}`;
          for (const capture of [false, true]) {
            const result = await shell.exec(capture ? `v=$(${command}); printf '%s' "$v"` : command);
            assert.equal(result.exitCode, 0, result.stderr);
            assert.equal(result.stderr, "");
            assert.equal(result.stdout, expected + (capture ? "" : "\n"), `${mode}, ${JSON.stringify(value)}, capture=${capture}, ${options}`);
          }
        }
      }
    } finally {
      await shell.dispose();
    }
  });
}
