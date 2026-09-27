import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import type { CommandContext, CommandDefinition } from "../../src/contracts/index.js";
import { createStreamFormatCommands } from "../../src/commands/stream-format/index.js";
import { createStreamInspectionCommands } from "../../src/commands/stream-inspection/index.js";
import { createTableTextCommands } from "../../src/commands/table-text/index.js";
import { createColumnCommand } from "../../src/commands/column/index.js";
import { createShufCommand } from "safe-bash-command-shuf";
import { textCommands } from "../../src/commands/text.js";
import { streamCommands } from "../../src/commands/streams.js";
import { fmtCommand } from "safe-bash-command-fmt";

const input = Array.from({ length: 1000 }, (_, index) => `${index + 1}\n`).join("");
const commands = [
  ...createStreamFormatCommands(), ...createStreamInspectionCommands(), ...createTableTextCommands(),
  createColumnCommand(), createShufCommand(), ...textCommands(), ...streamCommands(), fmtCommand(),
];
const cases: readonly [string, readonly string[], string | undefined][] = [
  ["nl", ["-w1", "-s|"], Array.from({ length: 1000 }, (_, index) => `${index + 1}|${index + 1}\n`).join("")],
  ["rev", [], input.split("\n").slice(0, -1).map(line => [...line].reverse().join("") + "\n").join("")],
  ["seq", ["1", "1000"], input], ["paste", ["-sd,"], input.trimEnd().split("\n").join(",") + "\n"],
  ["column", ["-t"], input], ["uniq", [], input], ["tac", [], input.trimEnd().split("\n").reverse().join("\n") + "\n"],
  ["tail", ["-n500"], input.split("\n").slice(500).join("\n")],
  ["fold", ["-w80"], input], ["fmt", ["-s", "-w80"], input], ["shuf", [], undefined],
];
for (const [name, args, expected] of cases) {
  test(`${name} coalesces output and preserves every record`, async () => {
    const definition = commands.find(command => command.name === name) as CommandDefinition;
    assert.ok(definition);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const context: CommandContext = {
      command: name, args, cwd: "/", env: { LC_ALL: "C" }, fs: createMemoryFileSystem(),
      signal: new AbortController().signal,
      stdin: (async function* () { yield Buffer.from(input); })(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += Buffer.from(bytes).toString(); } },
    };
    const result = await definition.execute(context);
    assert.equal(result.exitCode, 0, stderr);
    assert.ok(chunks.length <= 8, `${name} made ${chunks.length} sink writes`);
    const actual = Buffer.concat(chunks).toString();
    if (expected !== undefined) assert.equal(actual, expected);
    else assert.deepEqual(actual.trimEnd().split("\n").sort(), input.trimEnd().split("\n").sort());
  });
}

test("head with a negative count flushes accepted output before pulling another chunk", async () => {
  const definition = commands.find(command => command.name === "head")!;
  let reads = 0;
  const chunks: Uint8Array[] = [];
  const context: CommandContext = {
    command: "head", args: ["-n", "-1"], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: (async function* () {
      reads++; yield Buffer.from("a\nb\n");
      assert.equal(Buffer.concat(chunks).toString(), "a\n", "output must precede the next source pull");
      reads++; yield Buffer.from("c\n");
    })(),
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} },
  };
  assert.equal((await definition.execute(context)).exitCode, 0);
  assert.equal(reads, 2);
  assert.equal(Buffer.concat(chunks).toString(), "a\nb\n");
});


test("uniq flushes accepted groups before pulling another chunk", async () => {
  const definition = commands.find(command => command.name === "uniq")!;
  const chunks: Uint8Array[] = [];
  const context: CommandContext = {
    command: "uniq", args: ["--group=prepend"], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: (async function* () {
      yield Buffer.from("a\na\n");
      assert.equal(Buffer.concat(chunks).toString(), "\na\na\n", "output must precede the next source pull");
      yield Buffer.from("b\n");
    })(),
    stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write() {} },
  };
  assert.equal((await definition.execute(context)).exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString(), "\na\na\n\nb\n");
});
