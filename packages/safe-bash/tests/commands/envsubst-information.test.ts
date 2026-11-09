import assert from "node:assert/strict";
import test from "node:test";
import "../../src/shell/sync-extra-evaluators.js";
import { standardCommands } from "../../src/commands/index.js";
import { envsubstCommands } from "../../src/commands/envsubst/index.js";
import { Shell } from "../../src/shell/shell.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

// GNU gettext-runtime 0.21, Linux, LC_ALL=C: status and output selection.
// Help/version branding and invalid-option wording differ from this command.
for (const [args, status, output] of [
  ["-h --bad", 1, ""],
  ["-V --bad", 1, ""],
  ["--help --bad", 1, ""],
  ["--version --bad", 1, ""],
  ["-h -z", 1, ""],
  ["-V -z", 1, ""],
  ["--bad -h", 1, ""],
  ["-h format --bad", 1, ""],
  ["-h -V", 0, "envsubst ("],
  ["-V -h", 0, "envsubst ("],
  ["--help --version", 0, "envsubst ("],
  ["--version --help", 0, "envsubst ("],
  ["-h -v", 0, "Usage: envsubst"],
  ["-V -v", 0, "envsubst ("],
  ["-h first second", 0, "Usage: envsubst"],
  ["-h -- --bad", 0, "Usage: envsubst"],
  ["-- -h", 0, ""],
] as const) {
  for (const capture of [false, true]) {
    test(`envsubst information options ${args}, capture=${capture}`, async t => {
      const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } })
        .use(standardCommands()).use(envsubstCommands());
      t.after(() => shell.dispose());
      const command = `envsubst ${args}`;
      const script = capture
        ? `value=$(${command}); status=$?; printf '%s' "$value"; exit "$status"`
        : command;
      const result = await shell.exec(script);
      assert.equal(result.exitCode, status);
      if (output) assert.ok(result.stdout.startsWith(output), result.stdout);
      else assert.equal(result.stdout, "");
      if (status === 0) assert.equal(result.stderr, "");
      else assert.ok(result.stderr.includes(args.includes("--bad") ? "--bad" : "z"));
    });
  }
}
