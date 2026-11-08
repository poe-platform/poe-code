import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { createAliasCommand } from "./index.js";

test("alias storage admission leaves existing definitions intact", async () => {
  const aliases = new Map([["a", "old"]]);
  const command = createAliasCommand({ aliases, limits: { maxAliasBytes: 4 } });
  const context = { args: ["a=longer"], signal: new AbortController().signal } as CommandContext;
  await assert.rejects(async () => command.execute(context), /storage limit/);
  assert.deepEqual([...aliases], [["a", "old"]]);
});

test("alias printing round trips embedded single quotes", async () => {
  let stdout = "";
  const command = createAliasCommand({ aliases: new Map([["a", "echo 'value'"]]) });
  const context = { args: ["-p"], signal: new AbortController().signal,
    stdout: { write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
  } as CommandContext;
  assert.equal((await command.execute(context)).exitCode, 0);
  assert.equal(stdout, "alias a='echo '\\''value'\\'''\n");
});
