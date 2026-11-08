import assert from "node:assert/strict";
import test from "node:test";
import { createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { bcCommands } from "../../src/commands/bc/index.js";
import { splitCommands } from "../../src/commands/split/index.js";
import { searchCommands } from "../../src/commands/search/index.js";
import { grepCommands } from "../../src/commands/grep/index.js";
import { commandExecutor } from "../../src/plugins/composition.js";

for (const name of ["bc", "sqlite3", "fd"]) {
  test(`commandExecutor rejects ${name} when its lookup does not grant it`, async () => {
    const argumentsValue = createCommandArguments(["--help"]);
    let stdout = "", stderr = "";
    const execute = commandExecutor(() => undefined);
    const result = await execute({
      command: name, args: argumentsValue.args, argumentValues: argumentsValue,
      cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, 127);
    assert.equal(stdout, "");
    assert.ok(stderr.includes("command not found"));
  });
}

for (const search of [searchCommands, grepCommands]) {
  test(`${search.name} preserves explicit registration and invocation limits`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), limits: { commandLimits: { split: { maxSuffixLength: 2 } } } })
      .use(search()).use(bcCommands({ limits: { maxInputBytes: 3 } })).use(splitCommands());
    context.after(() => shell.dispose());
    const allowed = await shell.exec("bc", { stdin: "1+1" });
    assert.deepEqual([allowed.exitCode, allowed.stdout], [0, "2\n"]);
    const denied = await shell.exec("bc", { stdin: "100+200" });
    assert.notEqual(denied.exitCode, 0);
    assert.equal(denied.stdout, "");
    assert.ok(denied.stderr.includes("maximum size"));
    const split = await shell.exec("split -a3", { stdin: "x" });
    assert.equal(split.exitCode, 1);
    assert.equal(split.stderr, "split: split suffix length limit exceeded\n");
  });
}
