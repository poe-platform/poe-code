import assert from "node:assert/strict";
import test from "node:test";
import { predicateCommands } from "../../src/commands/predicates.js";
import { CommandRegistry, toByteSource } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/shell.js";

async function run(command: string, args: readonly string[]) {
  let stdout = "";
  let stderr = "";
  const result = await predicateCommands().find(definition => definition.name === command)!.execute({
    command, args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  });
  return { ...result, stdout, stderr };
}

for (const command of ["test", "["]) {
  const suffix = command === "[" ? ["]"] : [];
  test(`${command} compares GNU string-length numeric operands as UTF-8 bytes`, async () => {
    for (const [text, length] of [["", 0], ["abc def", 7], ["é", 2], ["🚀", 4], ["Changed β 🚀 tail", 20]] as const) {
      for (const [operator, expected] of [["-eq", 0], ["-ne", 1], ["-lt", 1], ["-le", 0], ["-gt", 1], ["-ge", 0]] as const) {
        for (const operands of [
          ["-l", text, operator, `+${length}`],
          [`+${length}`, operator, "-l", text],
          ["-l", text, operator, "-l", text],
          [`+${length}`, operator, `${length}`],
        ]) {
          const result = await run(command, [...operands, ...suffix]);
          assert.equal(result.exitCode, expected, JSON.stringify(operands));
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, "");
        }
      }
    }
    for (const [operands, expected] of [
      [["-l", "é", "-gt", "1"], 0],
      [["3", "-lt", "-l", "🚀"], 0],
      [["-l", "=", "-l"], 0],
      [["-n", "-l"], 0],
      [["-z", ""], 0],
      [["-l"], 0],
      [["-l", "!=", "other"], 0],
      [["(", "value", ")", "-o", ""], 0],
      [["!", "(", "-l", "", "-eq", "0", ")"], 1],
      [["-l", "é", "-eq", "2", "-a", "-l", "🚀", "-eq", "4"], 0],
    ] as const) {
      const result = await run(command, [...operands, ...suffix]);
      assert.equal(result.exitCode, expected, JSON.stringify(operands));
      assert.equal(result.stderr, "");
    }
  });

  test(`${command} rejects missing length operands and invalid integers`, async () => {
    for (const operands of [["2", "-eq", "-l"], ["-l", "abc", "-eq"], ["-l", "abc", "-eq", "invalid"], ["-l", "abc", "-eq", "3", "extra"], [...Array<string>(257).fill("!"), "value"]]) {
      const result = await run(command, [...operands, ...suffix]);
      assert.equal(result.exitCode, 2, JSON.stringify(operands));
      assert.notEqual(result.stderr, "");
    }
  });

  test(`${command} parses length predicates through the actual shell`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(predicateCommands()) });
    try {
      for (const [expression, expected] of [
        ["-l 'Changed β 🚀 tail' -gt 23", 1],
        ["20 -le -l 'Changed β 🚀 tail'", 0],
        ["-l '' -eq -l ''", 0],
        ["-l 'é' -lt -l '🚀'", 0],
        ["-l 'é' -ne -l '🚀'", 0],
        ["-l '🚀' -ge 5", 1],
      ] as const) {
        const result = await shell.exec(`${command} ${expression}${command === "[" ? " ]" : ""}`);
        assert.equal(result.exitCode, expected, expression);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, "");
      }
    } finally { await shell.dispose(); }
  });
}
