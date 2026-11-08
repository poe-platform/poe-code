import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";

const cases = [
  ["sed wildcard delete", "axb\na.b\nacb", "sed '/a.b/d'", ""],
  ["sed wildcard print", "axb\na.b\nacb", "sed -n '/a.b/p'", "axb\na.b\nacb"],
  ["sed reversed delete range", "a\nb\nc\nd", "sed '3,1d'", "a\nb\nd"],
  ["sed reversed print range", "a\nb\nc\nd", "sed -n '3,1p'", "c"],
  ["jq keys", '{"b":1,"a":2}', "jq '. | keys'", '[\n  "a",\n  "b"\n]'],
  ["jq object", '{"items":{"a":1}}', "jq .items", '{\n  "a": 1\n}'],
  ["jq compact", '{"b":1,"a":2}', "jq -c keys", '["a","b"]'],
  ["jq raw object", '{"items":[1,2]}', "jq -r .items", '[\n  1,\n  2\n]'],
  ["jq Unicode length", '"😀"', "jq length", "1"],
  ["jq number length", "-5", "jq length", "5"],
  ["jq long raw option", '"hello"', "jq --raw-output .", "hello"],
  ["jq long compact option", "[1,2]", "jq --compact-output .", "[1,2]"],
  ["jq iterator", "[1,2]", "jq '.[]'", "1\n2"],
] as const;
for (const [name, input, command, expected] of cases) {
  test(name, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...basicCommands(), ...createTextProgramCommands(), ...createStructuredCommands()]) });
    try {
      for (const loop of [false, true]) for (const producer of [command + ' <<< "$s"', 'printf "%s\\n" "$s" | ' + command]) {
        const result = await shell.exec(`s='${input}'; ${loop ? "for ((i=0;i<10;i++)); do" : ""} x=$(${producer}); ${loop ? "done;" : ""} printf '%s' "$x"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, expected);
      }
    } finally { await shell.dispose(); }
  });
}
for (const [input, filter] of [["[1,2]", ".foo"], ["123", ".foo"], ['{"a":1}', ".[0]"], ["bad", ".foo"], ["true", "length"]]) {
  test(`jq failure ${input} ${filter}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([...basicCommands(), ...createStructuredCommands()]) });
    try {
      const direct = await shell.exec(`jq '${filter}'`, { stdin: input + "\n" });
      assert.notEqual(direct.exitCode, 0);
      assert.notEqual(direct.stderr, "");
      for (const producer of [`jq '${filter}' <<< "$s"`, `printf '%s\\n' "$s" | jq '${filter}'`]) {
        const result = await shell.exec(`s='${input}'; for ((i=0;i<10;i++)); do x=$(${producer}); status=$?; done; printf '%s:%s' "$status" "$x"`);
        assert.equal(result.stdout, `${direct.exitCode}:`);
        assert.equal(result.stderr, direct.stderr.repeat(10));
      }
    } finally { await shell.dispose(); }
  });
}
