import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { getoptCommands } from "./index.js";

test("alternative long options agree in direct and captured execution", async () => {
  const shellSource = "../../safe-bash/src/core.js";
  const { Shell, standardCommands } = await import(shellSource);
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/" }).use(standardCommands()).use(getoptCommands());
  try {
    for (const [parameters, expected] of [
      ["-file name", " --file 'name' --"],
      ["-fil name", " --file 'name' --"],
      ["-file=name", " --file 'name' --"],
      ["--file name", " --file 'name' --"],
      ["-f name", " -f 'name' --"],
      ["-fname", " -f 'name' --"],
    ]) {
      const command = `getopt -a -o f: -l file: -- ${parameters}`;
      const direct = await shell.exec(command);
      assert.equal(direct.exitCode, 0, parameters);
      assert.equal(direct.stdout, expected + "\n", parameters);
      const captured = await shell.exec(`v=$(${command}); printf '%s\\n' "$v"`);
      assert.equal(captured.exitCode, 0, parameters);
      assert.equal(captured.stdout, direct.stdout, parameters);
    }
    const result = await shell.exec('v=$(getopt -a -o f: -l file: -- -file name); eval "set -- $v"; printf \'<%s>\\n\' "$@"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "<--file>\n<name>\n<-->\n");
  } finally {
    await shell.dispose();
  }
});
