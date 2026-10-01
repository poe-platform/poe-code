import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { createUnaliasCommand } from "./index.js";

test("unalias checks argument admission before clearing the table", async () => {
  const aliases = new Map([["a", "old"]]);
  const command = createUnaliasCommand({ aliases, limits: { maxArgumentBytes: 1 } });
  const context = { args: ["-a"], signal: new AbortController().signal } as CommandContext;
  await assert.rejects(async () => command.execute(context), /argument limit/);
  assert.deepEqual([...aliases], [["a", "old"]]);
});

test("unalias removes requested definitions and diagnoses missing ones", async () => {
  let stderr = "";
  const aliases = new Map([["a", "old"], ["b", "keep"]]);
  const command = createUnaliasCommand({ aliases });
  const context = { args: ["missing", "a"], signal: new AbortController().signal,
    stderr: { write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
  } as CommandContext;
  assert.equal((await command.execute(context)).exitCode, 1);
  assert.equal(stderr, "unalias: missing: not found\n");
  assert.deepEqual([...aliases], [["b", "keep"]]);
});
